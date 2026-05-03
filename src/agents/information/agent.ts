import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  createGlobalToolRegistry,
  executeGlobalTool,
  type GlobalToolName,
  type GlobalToolRegistry,
  type GlobalToolResult,
  type GlobalToolCitation,
  GLOBAL_MEMORY_CONTAINER_TAG,
  getAgentRunId,
  hasFinnhubPremiumAccess,
  observe,
} from "../../global/index.js";
import {
  buildInformationPlannerMessage,
  buildInformationSynthesisMessage,
  INFORMATION_PLANNER_SYSTEM_PROMPT,
  INFORMATION_SYNTHESIS_SYSTEM_PROMPT,
} from "./prompt.js";
import {
  informationPlanSchema,
  informationRequestSchema,
  informationResultSchema,
  informationToolResultSchema,
} from "./schema.js";
import type {
  InformationAgentDependencies,
  InformationPlan,
  InformationRequest,
  InformationResult,
  InformationToolName,
  InformationToolResult,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IGNORED_TICKER_TOKENS = new Set([
  "API",
  "CEO",
  "CFO",
  "CTO",
  "SEC",
  "USA",
  "USD",
  "THE",
  "AND",
  "FOR",
]);
const RESEARCH_QUERY_PATTERN = /research|why|material|catalyst|compare|latest/i;

const InformationState = Annotation.Root({
  request: Annotation<InformationRequest>(),
  plan: Annotation<InformationPlan | undefined>(),
  toolResults: Annotation<InformationToolResult[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  result: Annotation<InformationResult | undefined>(),
});

type InformationStateType = typeof InformationState.State;

function inferTicker(query: string): string | undefined {
  const match = query.match(/(?:^|[^A-Za-z])\$?([A-Z]{1,5})(?=[^A-Za-z]|$)/);
  const ticker = match?.[1];
  return ticker && !IGNORED_TICKER_TOKENS.has(ticker) ? ticker : undefined;
}

function extractUrls(input: string): string[] {
  return Array.from(input.matchAll(/https?:\/\/[^\s),]+/g)).map((match) =>
    match[0],
  );
}

function deterministicPlan(
  request: InformationRequest,
  deps: InformationAgentDependencies,
): InformationPlan {
  const toolCalls: InformationPlan["toolCalls"] = [];
  const ticker = inferTicker(request.query);
  const query = request.query.toLowerCase();
  const premiumAccess =
    deps.finnhubPremiumAccess ?? hasFinnhubPremiumAccess();

  if (deps.exa) {
    toolCalls.push({
      toolName: "exa_search",
      input: request.query,
    });
  }

  if (deps.exa && RESEARCH_QUERY_PATTERN.test(request.query)) {
    toolCalls.push({
      toolName: "exa_research",
      input: request.query,
    });
  }

  if (deps.exa && extractUrls(request.query).length > 0) {
    toolCalls.push({
      toolName: "exa_contents",
      input: request.query,
    });
  }

  if (deps.finnhub && ticker) {
    toolCalls.push({ toolName: "finnhub_quote", input: ticker });

    if (/news|headline|catalyst|recent|latest/i.test(request.query)) {
      toolCalls.push({ toolName: "finnhub_company_news", input: ticker });
    }
    if (/financial|valuation|metric|revenue|margin|growth|balance/i.test(query)) {
      toolCalls.push({ toolName: "finnhub_basic_financials", input: ticker });
    }
    if (
      premiumAccess &&
      /price|chart|technical|momentum|trend|support|resistance|candle/i.test(query)
    ) {
      toolCalls.push(
        { toolName: "finnhub_stock_candles", input: ticker },
        { toolName: "finnhub_aggregate_indicator", input: ticker },
      );
    }
    if (/earnings|eps|estimate/i.test(query)) {
      toolCalls.push(
        { toolName: "finnhub_company_earnings", input: ticker },
        { toolName: "finnhub_earnings_calendar", input: ticker },
      );
      if (premiumAccess) {
        toolCalls.push({ toolName: "finnhub_company_eps_estimates", input: ticker });
      }
    }
    if (/filing|sec|10-k|10-q|8-k/i.test(query)) {
      toolCalls.push(
        { toolName: "finnhub_filings", input: ticker },
        { toolName: "finnhub_financials_reported", input: ticker },
      );
    }
    if (/analyst|rating|upgrade|downgrade|recommendation/i.test(query)) {
      toolCalls.push({ toolName: "finnhub_recommendation_trends", input: ticker });
      if (premiumAccess) {
        toolCalls.push({ toolName: "finnhub_upgrade_downgrade", input: ticker });
      }
    }
    if (premiumAccess && /ownership|holder|institution/i.test(query)) {
      toolCalls.push({ toolName: "finnhub_ownership", input: ticker });
    }
    if (/insider|executive transaction/i.test(query)) {
      toolCalls.push({ toolName: "finnhub_insider_transactions", input: ticker });
    }
    if (premiumAccess && /sentiment|social|reddit|twitter/i.test(query)) {
      toolCalls.push(
        { toolName: "finnhub_news_sentiment", input: ticker },
        { toolName: "finnhub_social_sentiment", input: ticker },
      );
    }
    if (/peer|competitor|profile|sector|industry/i.test(query)) {
      toolCalls.push(
        { toolName: "finnhub_company_profile", input: ticker },
        { toolName: "finnhub_company_peers", input: ticker },
      );
    }
    if (premiumAccess && /press release|announcement/i.test(query)) {
      toolCalls.push({ toolName: "finnhub_press_releases", input: ticker });
    }
    if (premiumAccess && /supply chain|supplier|customer/i.test(query)) {
      toolCalls.push({
        toolName: "finnhub_supply_chain_relationships",
        input: ticker,
      });
    }
  }

  if (deps.memory ?? deps.supermemory) {
    toolCalls.push({
      toolName: "supermemory_search",
      input: request.query,
    });
  }

  return {
    reasoning:
      "Use available search, market data, and memory tools to gather concise context.",
    toolCalls: toolCalls.slice(0, 5),
  };
}

function requireDeterministicFallback(
  deps: InformationAgentDependencies,
  stage: "planner" | "synthesis",
): void {
  if (!deps.allowDeterministicFallback) {
    throw new Error(
      [
        `Information ${stage} model is required.`,
        "Deterministic fallback is disabled because it does not preserve enough production functionality.",
        "Pass a model/plannerModel/synthesisModel, or explicitly set allowDeterministicFallback for tests.",
      ].join(" "),
    );
  }
}

async function invokeStructured<T>(
  model: {
    withStructuredOutput: <U>(schema: unknown) => {
      invoke: (input: unknown) => Promise<U>;
    };
  },
  schema: unknown,
  input: unknown,
): Promise<T> {
  return await model.withStructuredOutput<T>(schema).invoke(input);
}

async function executeToolCall(input: {
  request: InformationRequest;
  toolName: InformationToolName;
  toolInput: string;
  deps: InformationAgentDependencies;
  registry: GlobalToolRegistry;
}): Promise<InformationToolResult> {
  const { request, toolName, toolInput, deps, registry } = input;
  const memoryContainerTag =
    deps.supermemoryContainerTag ?? GLOBAL_MEMORY_CONTAINER_TAG;

  try {
    await observe(deps.observer, {
      agent: "information",
      type: "tool_start",
      runId: deps.runId,
      payload: {
        toolName,
        input: toolInput,
        query: request.query,
      },
    });
    const result = await executeGlobalTool({
      registry,
      toolName: toolName as GlobalToolName,
      toolInput,
      context: {
        query: request.query,
        containerTag: memoryContainerTag,
        now: deps.now?.() ?? new Date(),
      },
    });

    const parsed = informationToolResultSchema.parse({
      toolName,
      input: toolInput,
      summary: result.summary,
      citations: normalizeCitations(result.citations ?? []),
      raw: result.raw,
    });
    await observe(deps.observer, {
      agent: "information",
      type: "tool_complete",
      runId: deps.runId,
      payload: {
        toolName,
        input: toolInput,
        citationCount: parsed.citations.length,
        summaryLength: parsed.summary.length,
      },
    });
    return parsed;
  } catch (error) {
    await observe(deps.observer, {
      agent: "information",
      type: "tool_error",
      runId: deps.runId,
      payload: {
        toolName,
        input: toolInput,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    if (deps.requiredTools?.[toolName] === true) {
      throw error;
    }

    return informationToolResultSchema.parse({
      toolName,
      input: toolInput,
      summary: [
        `Tool ${toolName} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "Continue with other completed tool results. Do not retry the same call unless a corrected parameter is obvious.",
      ].join(" "),
      citations: [],
    });
  }
}

function normalizeCitations(citations: GlobalToolCitation[]) {
  return citations
    .filter((item) => item.url.trim().length > 0)
    .map((item) => ({
      title: item.title,
      url: item.url,
      source: item.source,
    }));
}

function deterministicSynthesis(toolResults: InformationToolResult[]): InformationResult {
  const citations = toolResults.flatMap((result) => result.citations);
  return {
    summary: toolResults
      .map((result) => `${result.toolName}: ${result.summary}`)
      .join("\n\n"),
    citations,
  };
}

function getEnabledToolNames(
  registry: GlobalToolRegistry,
  deps: InformationAgentDependencies,
): InformationToolName[] {
  return Object.keys(registry).filter((toolName): toolName is InformationToolName => {
    return deps.enabledTools?.[toolName as InformationToolName] !== false;
  });
}

export function createInformationAgentGraph(
  deps: InformationAgentDependencies = {},
) {
  const registry = createGlobalToolRegistry({
    exa: deps.exa,
    finnhub: deps.finnhub,
    finnhubPremiumAccess: deps.finnhubPremiumAccess,
    requiredTools: deps.requiredTools as Partial<Record<GlobalToolName, boolean>>,
    memory: deps.memory ?? deps.supermemory,
    memoryContainerTag:
      deps.supermemoryContainerTag ?? GLOBAL_MEMORY_CONTAINER_TAG,
    now: deps.now,
  });
  const enabledToolNames = getEnabledToolNames(registry, deps);

  const planNode = async (
    state: InformationStateType,
  ): Promise<{ plan: InformationPlan }> => {
    await observe(deps.observer, {
      agent: "information",
      type: "plan_start",
      runId: deps.runId,
      payload: { query: state.request.query },
    });
    const plannerModel = deps.plannerModel ?? deps.model;
    if (!plannerModel) {
      requireDeterministicFallback(deps, "planner");
    }
    const rawPlan = plannerModel
      ? await invokeStructured<InformationPlan>(
          plannerModel,
          informationPlanSchema,
          [
            new SystemMessage(INFORMATION_PLANNER_SYSTEM_PROMPT),
            new HumanMessage(
              buildInformationPlannerMessage(state.request, {
                finnhubPremiumAccess: deps.finnhubPremiumAccess,
                availableTools: enabledToolNames,
              }),
            ),
          ],
        )
      : deterministicPlan(state.request, deps);

    const plan = informationPlanSchema.parse(rawPlan);
    await observe(deps.observer, {
      agent: "information",
      type: "plan_complete",
      runId: deps.runId,
      payload: {
        reasoning: plan.reasoning,
        toolCalls: plan.toolCalls,
      },
    });
    return {
      plan: {
        ...plan,
        toolCalls: plan.toolCalls
          .filter((toolCall) => enabledToolNames.includes(toolCall.toolName))
          .slice(0, deps.maxToolCalls ?? 5),
      },
    };
  };

  const executeNode = async (
    state: InformationStateType,
  ): Promise<{ toolResults: InformationToolResult[] }> => {
    if (!state.plan) {
      throw new Error("Information plan was not created before tool execution.");
    }
    await observe(deps.observer, {
      agent: "information",
      type: "tools_start",
      runId: deps.runId,
      payload: {
        toolCallCount: state.plan.toolCalls.length,
        toolNames: state.plan.toolCalls.map((toolCall) => toolCall.toolName),
      },
    });

    const toolResults = await Promise.all(
      state.plan.toolCalls.map((toolCall) =>
        executeToolCall({
          request: state.request,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          deps,
          registry,
        }),
      ),
    );
    await observe(deps.observer, {
      agent: "information",
      type: "tools_complete",
      runId: deps.runId,
      payload: {
        toolResultCount: toolResults.length,
        citationCount: toolResults.flatMap((result) => result.citations).length,
      },
    });

    return { toolResults };
  };

  const synthesizeNode = async (
    state: InformationStateType,
  ): Promise<{ result: InformationResult }> => {
    await observe(deps.observer, {
      agent: "information",
      type: "synthesis_start",
      runId: deps.runId,
      payload: {
        query: state.request.query,
        toolResultCount: state.toolResults.length,
      },
    });
    const synthesisModel = deps.synthesisModel ?? deps.model;
    if (!synthesisModel) {
      requireDeterministicFallback(deps, "synthesis");
    }
    const rawResult = synthesisModel
      ? await invokeStructured<InformationResult>(
          synthesisModel,
          informationResultSchema,
          [
            new SystemMessage(INFORMATION_SYNTHESIS_SYSTEM_PROMPT),
            new HumanMessage(
              buildInformationSynthesisMessage({
                request: state.request,
                toolResults: state.toolResults,
              }),
            ),
          ],
        )
      : deterministicSynthesis(state.toolResults);

    const parsed = informationResultSchema.parse(rawResult);
    await observe(deps.observer, {
      agent: "information",
      type: "synthesis_complete",
      runId: deps.runId,
      payload: {
        summaryLength: parsed.summary.length,
        citationCount: parsed.citations.length,
      },
    });
    return {
      result: parsed,
    };
  };

  return new StateGraph(InformationState)
    .addNode("planner", planNode)
    .addNode("tool_executor", executeNode)
    .addNode("synthesizer", synthesizeNode)
    .addEdge(START, "planner")
    .addEdge("planner", "tool_executor")
    .addEdge("tool_executor", "synthesizer")
    .addEdge("synthesizer", END)
    .compile();
}

export async function runInformationAgent(
  query: string,
  deps: InformationAgentDependencies = {},
): Promise<InformationResult> {
  const runId = getAgentRunId("information", deps.runId);
  const runDeps = { ...deps, runId };
  const parsedRequest = informationRequestSchema.parse({ query });
  await observe(runDeps.observer, {
    agent: "information",
    type: "run_start",
    runId,
    payload: { query: parsedRequest.query },
  });
  const graph = createInformationAgentGraph(runDeps);
  const result = await graph.invoke({
    request: parsedRequest,
    toolResults: [],
  });

  const parsedResult = informationResultSchema.parse(result.result);
  await observe(runDeps.observer, {
    agent: "information",
    type: "run_complete",
    runId,
    payload: {
      summaryLength: parsedResult.summary.length,
      citationCount: parsedResult.citations.length,
    },
  });
  await runDeps.supermemoryMirror?.mirrorInformationResult({
    query: parsedRequest.query,
    result: parsedResult,
    runId,
  });
  return parsedResult;
}
