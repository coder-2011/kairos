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
    toolCalls.push(
      { toolName: "finnhub_quote", input: ticker },
      { toolName: "finnhub_company_news", input: ticker },
      { toolName: "finnhub_basic_financials", input: ticker },
    );
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

    return informationToolResultSchema.parse({
      toolName,
      input: toolInput,
      summary: result.summary,
      citations: normalizeCitations(result.citations ?? []),
      raw: result.raw,
    });
  } catch (error) {
    return informationToolResultSchema.parse({
      toolName,
      input: toolInput,
      summary: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
      citations: [],
    });
  }
}

function normalizeCitations(citations: GlobalToolCitation[]) {
  return citations.map((item) => ({
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

export function createInformationAgentGraph(
  deps: InformationAgentDependencies = {},
) {
  const registry = createGlobalToolRegistry({
    exa: deps.exa,
    finnhub: deps.finnhub,
    memory: deps.memory ?? deps.supermemory,
    memoryContainerTag:
      deps.supermemoryContainerTag ?? GLOBAL_MEMORY_CONTAINER_TAG,
    now: deps.now,
  });

  const planNode = async (
    state: InformationStateType,
  ): Promise<{ plan: InformationPlan }> => {
    const rawPlan = deps.model
      ? await invokeStructured<InformationPlan>(
          deps.model,
          informationPlanSchema,
          [
            new SystemMessage(INFORMATION_PLANNER_SYSTEM_PROMPT),
            new HumanMessage(buildInformationPlannerMessage(state.request)),
          ],
        )
      : deterministicPlan(state.request, deps);

    const plan = informationPlanSchema.parse(rawPlan);
    return {
      plan: {
        ...plan,
        toolCalls: plan.toolCalls.slice(0, 5),
      },
    };
  };

  const executeNode = async (
    state: InformationStateType,
  ): Promise<{ toolResults: InformationToolResult[] }> => {
    if (!state.plan) {
      throw new Error("Information plan was not created before tool execution.");
    }

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

    return { toolResults };
  };

  const synthesizeNode = async (
    state: InformationStateType,
  ): Promise<{ result: InformationResult }> => {
    const rawResult = deps.model
      ? await invokeStructured<InformationResult>(
          deps.model,
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
  const parsedRequest = informationRequestSchema.parse({ query });
  const graph = createInformationAgentGraph(deps);
  const result = await graph.invoke({
    request: parsedRequest,
    toolResults: [],
  });

  return informationResultSchema.parse(result.result);
}
