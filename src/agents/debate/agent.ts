import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { getAgentRunId, observe } from "../../global/index.js";
import { executeGlobalTool, type GlobalToolName } from "../../global/tools.js";
import {
  BEAR_SYSTEM_PROMPT,
  BULL_SYSTEM_PROMPT,
  buildDebateContextMessage,
  FINAL_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
} from "./prompt.js";
import {
  debateAgentOutputSchema,
  debateDecisionSchema,
  debateStartInputSchema,
  debateToolEventSchema,
  defaultDebateBudgets,
  humanInterjectionSchema,
  judgePlanSchema,
} from "./schema.js";
import type {
  DebateAgentName,
  DebateAgentOutput,
  DebateBudgetState,
  DebateDecision,
  DebateGraphDependencies,
  DebateMessage,
  DebateRunConfig,
  DebateRunResult,
  DebateStatus,
  DebateToolEvent,
  HumanInterjection,
  JudgePlan,
  PendingToolRequest,
} from "./types.js";

const DebateGraphState = Annotation.Root({
  debateId: Annotation<string>(),
  status: Annotation<DebateStatus>(),
  startInput: Annotation<ReturnType<typeof debateStartInputSchema.parse>>(),
  messages: Annotation<DebateMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  toolEvents: Annotation<DebateToolEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  currentPlan: Annotation<JudgePlan | undefined>(),
  humanInterjections: Annotation<HumanInterjection[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  finalDecision: Annotation<DebateDecision | undefined>(),
  budgets: Annotation<DebateBudgetState>(),
  pendingToolRequest: Annotation<PendingToolRequest | null>(),
  createdAt: Annotation<string>(),
  updatedAt: Annotation<string>(),
});

type DebateState = typeof DebateGraphState.State;

const DEFAULT_JUDGE_PLAN: JudgePlan = {
  plan: "Start with the bull case, then hear the bear case, then synthesize.",
  nextNode: "bull",
};

function isoNow(deps: DebateGraphDependencies): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function defaultId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function buildModelInput(state: DebateState, systemPrompt: string): unknown[] {
  return [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      buildDebateContextMessage({
        startInput: state.startInput,
        messages: state.messages,
        toolEvents: state.toolEvents,
        humanInterjections: state.humanInterjections,
        currentPlan: state.currentPlan,
      }),
    ),
  ];
}

async function invokeStructured<T>(
  model: { withStructuredOutput: <U>(schema: unknown) => { invoke: (input: unknown) => Promise<U> } },
  schema: unknown,
  input: unknown,
): Promise<T> {
  return await model.withStructuredOutput<T>(schema).invoke(input);
}

async function ensureDebateNotCanceled(
  deps: DebateGraphDependencies,
): Promise<void> {
  if (!deps.isCanceled) return;
  const canceled = await Promise.resolve(deps.isCanceled());
  if (canceled) {
    throw new Error("Debate run was canceled by user.");
  }
}

function countMessages(
  state: DebateState,
  agentName: DebateAgentName,
  messageType?: DebateMessage["messageType"],
): number {
  return state.messages.filter(
    (message) =>
      message.agentName === agentName &&
      (messageType === undefined || message.messageType === messageType),
  ).length;
}

function deterministicJudgePlan(state: DebateState): JudgePlan {
  if (state.budgets.turnsUsed >= state.budgets.maxTurns) {
    return {
      plan: "Turn budget reached. Move to final synthesis.",
      nextNode: "final",
    };
  }

  if (countMessages(state, "bull", "argument") === 0) {
    return DEFAULT_JUDGE_PLAN;
  }

  if (countMessages(state, "bear", "argument") === 0) {
    return {
      plan: "The bull case has been heard. Let the bear case respond.",
      nextNode: "bear",
    };
  }

  return {
    plan: "Both sides have made their core arguments. Move to final synthesis.",
    nextNode: "final",
  };
}

function deterministicAgentOutput(
  role: "bull" | "bear",
  state: DebateState,
): DebateAgentOutput {
  const noun = role === "bull" ? "actionable" : "risky";
  return {
    argument: `${role} argument: based on the debate summary and seeded financials, this event may be ${noun}.`,
    confidence: 0.5,
    toolRequest:
      state.budgets.toolCallsUsed === 0
        ? {
            toolName: "information",
            input: `Check the most important context for: ${state.startInput.summary}`,
          }
        : null,
  };
}

function deterministicFinalDecision(state: DebateState): DebateDecision {
  const citations = uniqueCitations(
    state.toolEvents.flatMap((event) => event.citations),
  );
  return {
    summary: `Final synthesis based on ${state.messages.length} messages and ${state.toolEvents.length} tool result(s).`,
    action: "watch",
    confidence: 0.5,
    citations,
  };
}

function summarizePortfolioContext(
  portfolioContext: DebateState["startInput"]["portfolioContext"],
): string {
  if (!portfolioContext) {
    return "No portfolio context was provided for this debate.";
  }

  const account = readRecord(portfolioContext.account);
  const positions = Array.isArray(portfolioContext.positions)
    ? portfolioContext.positions
    : [];
  const recentTradeIntents = Array.isArray(portfolioContext.recentTradeIntents)
    ? portfolioContext.recentTradeIntents
    : [];
  const recentBrokerOrders = Array.isArray(portfolioContext.recentBrokerOrders)
    ? portfolioContext.recentBrokerOrders
    : [];
  const accountParts = [
    formatNumberField("cash", account?.cash),
    formatNumberField("buyingPower", account?.buyingPower),
    formatNumberField("portfolioValue", account?.portfolioValue),
    formatNumberField("equity", account?.equity),
    formatNumberField("unrealizedPl", account?.unrealizedPl),
  ].filter(Boolean);
  const positionLines = positions.slice(0, 8).map((position) => {
    const record = readRecord(position);
    return [
      record?.symbol,
      formatNumberField("qty", record?.qty),
      formatNumberField("marketValue", record?.marketValue),
      formatNumberField("currentPrice", record?.currentPrice),
      formatNumberField("unrealizedPl", record?.unrealizedPl),
    ]
      .filter(Boolean)
      .join(" ");
  });
  const tradeIntentLines = recentTradeIntents.slice(0, 8).map((intent) => {
    const record = readRecord(intent);
    return [
      record?.symbol,
      record?.side,
      record?.status,
      formatNumberField("confidence", record?.confidence),
      formatNumberField("notional", record?.notional),
      record?.createdAt,
    ]
      .filter(Boolean)
      .join(" ");
  });
  const brokerOrderLines = recentBrokerOrders.slice(0, 8).map((order) => {
    const record = readRecord(order);
    return [
      record?.symbol,
      record?.side,
      record?.status,
      record?.type,
      formatNumberField("qty", record?.qty),
      formatNumberField("notional", record?.notional),
      record?.submittedAt ?? record?.createdAt,
    ]
      .filter(Boolean)
      .join(" ");
  });
  const capturedAt =
    typeof portfolioContext.capturedAt === "string"
      ? `capturedAt=${portfolioContext.capturedAt}`
      : undefined;

  return [
    "Portfolio context:",
    capturedAt,
    accountParts.length > 0 ? `account ${accountParts.join(" ")}` : undefined,
    positionLines.length > 0
      ? `positions\n${positionLines.join("\n")}`
      : "positions none reported",
    tradeIntentLines.length > 0
      ? `recent trade intents\n${tradeIntentLines.join("\n")}`
      : "recent trade intents none reported",
    brokerOrderLines.length > 0
      ? `recent broker orders\n${brokerOrderLines.join("\n")}`
      : "recent broker orders none reported",
  ]
    .filter(Boolean)
    .join("\n");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatNumberField(label: string, value: unknown): string | undefined {
  return typeof value === "number" ? `${label}=${value}` : undefined;
}

function requireDeterministicFallback(
  deps: DebateGraphDependencies,
  role: "judge" | "bull" | "bear" | "final",
): void {
  if (!deps.allowDeterministicFallback) {
    throw new Error(
      [
        `Debate ${role} model is required.`,
        "Deterministic fallback is disabled because it does not preserve enough production functionality.",
        "Pass all debate models, or explicitly set allowDeterministicFallback for tests.",
      ].join(" "),
    );
  }
}

function uniqueCitations(
  citations: DebateDecision["citations"],
): DebateDecision["citations"] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.url)) {
      return false;
    }

    seen.add(citation.url);
    return true;
  });
}

export function createDebateGraph(deps: DebateGraphDependencies = {}) {
  const prompts = {
    judgeSystemPrompt: deps.prompts?.judgeSystemPrompt ?? JUDGE_SYSTEM_PROMPT,
    bullSystemPrompt: deps.prompts?.bullSystemPrompt ?? BULL_SYSTEM_PROMPT,
    bearSystemPrompt: deps.prompts?.bearSystemPrompt ?? BEAR_SYSTEM_PROMPT,
    finalSystemPrompt: deps.prompts?.finalSystemPrompt ?? FINAL_SYSTEM_PROMPT,
  };

  const judgeNode = async (
    state: DebateState,
  ): Promise<{
    currentPlan: JudgePlan;
    messages: DebateMessage[];
    pendingToolRequest: null;
    updatedAt: string;
  }> => {
    await ensureDebateNotCanceled(deps);
    await observe(deps.observer, {
      agent: "debate",
      type: "judge_start",
      runId: deps.runId,
      branchId: branchIdFromState(state),
      payload: {
        debateId: state.debateId,
        messageCount: state.messages.length,
        toolEventCount: state.toolEvents.length,
      },
    });
    if (!deps.models?.judge) {
      requireDeterministicFallback(deps, "judge");
    }
    await ensureDebateNotCanceled(deps);
    const rawPlan = deps.models?.judge
      ? await invokeStructured<JudgePlan>(
          deps.models.judge,
          judgePlanSchema,
          buildModelInput(state, prompts.judgeSystemPrompt),
        )
      : deterministicJudgePlan(state);
    await ensureDebateNotCanceled(deps);
    const plan = judgePlanSchema.parse(rawPlan);
    await observe(deps.observer, {
      agent: "debate",
      type: "judge_complete",
      runId: deps.runId,
      branchId: branchIdFromState(state),
      payload: {
        debateId: state.debateId,
        plan: plan.plan,
        nextNode: plan.nextNode,
      },
    });

    return {
      currentPlan: plan,
      messages: [
        {
          agentName: "judge",
          messageType: "plan",
          argument: plan.plan,
        },
      ],
      pendingToolRequest: null,
      updatedAt: isoNow(deps),
    };
  };

  const createDebateParticipantNode =
    (role: "bull" | "bear", systemPrompt: string) =>
    async (
      state: DebateState,
    ): Promise<{
      messages: DebateMessage[];
      pendingToolRequest: PendingToolRequest | null;
      budgets: DebateBudgetState;
      updatedAt: string;
    }> => {
      await ensureDebateNotCanceled(deps);
      await observe(deps.observer, {
        agent: "debate",
        type: `${role}_start`,
        runId: deps.runId,
        branchId: branchIdFromState(state),
        payload: {
          debateId: state.debateId,
          turnsUsed: state.budgets.turnsUsed,
          toolCallsUsed: state.budgets.toolCallsUsed,
        },
      });
      if (!deps.models?.[role]) {
        requireDeterministicFallback(deps, role);
      }
      await ensureDebateNotCanceled(deps);
      const rawOutput = deps.models?.[role]
        ? await invokeStructured<DebateAgentOutput>(
            deps.models[role],
            debateAgentOutputSchema,
            buildModelInput(state, systemPrompt),
          )
        : deterministicAgentOutput(role, state);
      await ensureDebateNotCanceled(deps);
      const output = debateAgentOutputSchema.parse(rawOutput);
      const requestedTool = output.toolRequest
        ? { ...output.toolRequest, requestedBy: role }
        : null;
      const toolRequest =
        requestedTool && state.budgets.toolCallsUsed < state.budgets.maxToolCalls
          ? requestedTool
          : null;
      await observe(deps.observer, {
        agent: "debate",
        type: `${role}_complete`,
        runId: deps.runId,
        branchId: branchIdFromState(state),
        payload: {
          debateId: state.debateId,
          argumentLength: output.argument.length,
          confidence: output.confidence,
          toolRequest,
        },
      });

      return {
        messages: [
          {
            agentName: role,
            messageType: "argument",
            argument: output.argument,
            confidence: output.confidence,
          },
        ],
        pendingToolRequest: toolRequest,
        budgets: {
          ...state.budgets,
          turnsUsed: state.budgets.turnsUsed + 1,
        },
        updatedAt: isoNow(deps),
      };
    };

  const toolsNode = async (
      state: DebateState,
    ): Promise<{
      messages: DebateMessage[];
    toolEvents: DebateToolEvent[];
    pendingToolRequest: null;
    budgets: DebateBudgetState;
    updatedAt: string;
  }> => {
    if (!state.pendingToolRequest) {
      return {
        messages: [],
        toolEvents: [],
        pendingToolRequest: null,
        budgets: state.budgets,
        updatedAt: isoNow(deps),
      };
    }

    const startedAt = isoNow(deps);
    const id = deps.id?.() ?? defaultId();
    const debateTool = deps.tools?.[state.pendingToolRequest.toolName];
    const globalTool =
      deps.globalTools?.[state.pendingToolRequest.toolName as GlobalToolName];
    const builtInPortfolioTool =
      state.pendingToolRequest.toolName === "portfolio";
    await ensureDebateNotCanceled(deps);
    await observe(deps.observer, {
      agent: "debate",
      type: "tool_start",
      runId: deps.runId,
      branchId: branchIdFromState(state),
      payload: {
        debateId: state.debateId,
        toolEventId: id,
        toolName: state.pendingToolRequest.toolName,
        requestedBy: state.pendingToolRequest.requestedBy,
        input: state.pendingToolRequest.input,
      },
    });

    try {
      if (deps.enabledTools?.[state.pendingToolRequest.toolName] === false) {
        throw new Error(
          `Tool ${state.pendingToolRequest.toolName} is disabled for this debate.`,
        );
      }

      if (!debateTool && !globalTool && !builtInPortfolioTool) {
        throw new Error(
          `No implementation registered for tool ${state.pendingToolRequest.toolName}.`,
        );
      }

      await ensureDebateNotCanceled(deps);
      const result = builtInPortfolioTool
        ? {
            summary: summarizePortfolioContext(state.startInput.portfolioContext),
            citations: [],
          }
        : debateTool
          ? await debateTool(state.pendingToolRequest.input, {
            debateId: state.debateId,
            requestedBy: state.pendingToolRequest.requestedBy,
            startInput: state.startInput,
          })
          : await executeGlobalTool({
            registry: deps.globalTools ?? {},
            toolName: state.pendingToolRequest.toolName as GlobalToolName,
            toolInput: state.pendingToolRequest.input,
            context: {
              debateId: state.debateId,
              requestedBy: state.pendingToolRequest.requestedBy,
              startInput: state.startInput,
            },
          });
      await ensureDebateNotCanceled(deps);

      const event = debateToolEventSchema.parse({
        toolEventId: id,
        debateId: state.debateId,
        toolName: state.pendingToolRequest.toolName,
        requestedBy: state.pendingToolRequest.requestedBy,
        input: state.pendingToolRequest.input,
        summary: result.summary,
        outputRef: result.outputRef,
        citations: result.citations ?? [],
        status: "completed",
        startedAt,
        completedAt: isoNow(deps),
      });
      await observe(deps.observer, {
        agent: "debate",
        type: "tool_complete",
        runId: deps.runId,
        branchId: branchIdFromState(state),
        payload: {
          debateId: state.debateId,
          toolEventId: event.toolEventId,
          toolName: event.toolName,
          requestedBy: event.requestedBy,
          citationCount: event.citations.length,
          summaryLength: event.summary.length,
        },
      });

      return {
        messages: [
          {
            agentName: "tool_agent",
            messageType: "tool_result",
            argument: event.summary,
          },
        ],
        toolEvents: [event],
        pendingToolRequest: null,
        budgets: {
          ...state.budgets,
          toolCallsUsed: state.budgets.toolCallsUsed + 1,
        },
        updatedAt: isoNow(deps),
      };
    } catch (error) {
      const event = debateToolEventSchema.parse({
        toolEventId: id,
        debateId: state.debateId,
        toolName: state.pendingToolRequest.toolName,
        requestedBy: state.pendingToolRequest.requestedBy,
        input: state.pendingToolRequest.input,
        summary: "Tool call failed.",
        citations: [],
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: isoNow(deps),
      });
      await observe(deps.observer, {
        agent: "debate",
        type: "tool_error",
        runId: deps.runId,
        branchId: branchIdFromState(state),
        payload: {
          debateId: state.debateId,
          toolEventId: event.toolEventId,
          toolName: event.toolName,
          requestedBy: event.requestedBy,
          error: event.error,
        },
      });
      if (deps.requiredTools?.[state.pendingToolRequest.toolName] === true) {
        throw error;
      }

      return {
        messages: [
          {
            agentName: "tool_agent",
            messageType: "tool_result",
            argument: `${event.summary} ${event.error ?? ""}`.trim(),
          },
        ],
        toolEvents: [event],
        pendingToolRequest: null,
        budgets: {
          ...state.budgets,
          toolCallsUsed: state.budgets.toolCallsUsed + 1,
        },
        updatedAt: isoNow(deps),
      };
    }
  };

  const humanContextNode = async (
    state: DebateState,
  ): Promise<{ updatedAt: string }> => {
    return { updatedAt: isoNow(deps) };
  };

  const finalNode = async (
    state: DebateState,
  ): Promise<{
    messages: DebateMessage[];
    finalDecision: DebateDecision;
    status: "completed";
    updatedAt: string;
  }> => {
    await ensureDebateNotCanceled(deps);
    await observe(deps.observer, {
      agent: "debate",
      type: "final_start",
      runId: deps.runId,
      branchId: branchIdFromState(state),
      payload: {
        debateId: state.debateId,
        messageCount: state.messages.length,
        toolEventCount: state.toolEvents.length,
      },
    });
    if (!deps.models?.final) {
      requireDeterministicFallback(deps, "final");
    }
    await ensureDebateNotCanceled(deps);
    const rawDecision = deps.models?.final
      ? await invokeStructured<DebateDecision>(
          deps.models.final,
          debateDecisionSchema,
          buildModelInput(state, prompts.finalSystemPrompt),
        )
      : deterministicFinalDecision(state);
    await ensureDebateNotCanceled(deps);
    const parsedDecision = debateDecisionSchema.parse(rawDecision);
    const decision = {
      ...parsedDecision,
      citations: uniqueCitations(parsedDecision.citations),
    };
    await observe(deps.observer, {
      agent: "debate",
      type: "final_complete",
      runId: deps.runId,
      branchId: branchIdFromState(state),
      payload: {
        debateId: state.debateId,
        summaryLength: decision.summary.length,
        confidence: decision.confidence,
        citationCount: decision.citations.length,
      },
    });

    return {
      messages: [
        {
          agentName: "judge",
          messageType: "final",
          argument: decision.summary,
          confidence: decision.confidence,
        },
      ],
      finalDecision: decision,
      status: "completed",
      updatedAt: isoNow(deps),
    };
  };

  const routeJudge = (state: DebateState): "bull" | "bear" | "final" => {
    if (state.budgets.turnsUsed >= state.budgets.maxTurns) {
      return "final";
    }

    return state.currentPlan?.nextNode ?? "final";
  };

  const routeParticipant = (state: DebateState): "tools" | "judge" => {
    return state.pendingToolRequest ? "tools" : "judge";
  };

  return new StateGraph(DebateGraphState)
    .addNode("judge", judgeNode)
    .addNode("bull", createDebateParticipantNode("bull", prompts.bullSystemPrompt))
    .addNode("bear", createDebateParticipantNode("bear", prompts.bearSystemPrompt))
    .addNode("tools", toolsNode)
    .addNode("human_context", humanContextNode)
    .addNode("final", finalNode)
    .addEdge(START, "human_context")
    .addConditionalEdges("judge", routeJudge)
    .addConditionalEdges("bull", routeParticipant)
    .addConditionalEdges("bear", routeParticipant)
    .addEdge("tools", "judge")
    .addEdge("human_context", "judge")
    .addEdge("final", END)
    .compile({ checkpointer: new MemorySaver() });
}

export async function runDebateAgent(
  config: DebateRunConfig,
  deps: DebateGraphDependencies = {},
): Promise<DebateRunResult> {
  const runId = getAgentRunId("debate", deps.runId);
  const runDeps = { ...deps, runId };
  const startInput = debateStartInputSchema.parse(config.startInput);
  const humanInterjections = (config.humanInterjections ?? []).map((item) =>
    humanInterjectionSchema.parse(item),
  );
  const now = isoNow(runDeps);
  const graph = createDebateGraph(runDeps);
  const budgets = {
    ...defaultDebateBudgets,
    ...config.budgets,
    turnsUsed: 0,
    toolCallsUsed: 0,
  };
  await observe(runDeps.observer, {
    agent: "debate",
    type: "run_start",
    runId,
    branchId: branchIdFromStartInput(startInput),
    payload: {
      debateId: config.debateId,
      summaryLength: startInput.summary.length,
      budgets,
    },
  });

  const result = await graph.invoke(
    {
      debateId: config.debateId,
      status: "running",
      startInput,
      messages: [],
      toolEvents: [],
      humanInterjections,
      budgets,
      pendingToolRequest: null,
      createdAt: now,
      updatedAt: now,
    },
    { configurable: { thread_id: config.debateId } },
  );

  const finalDecision = debateDecisionSchema.parse(result.finalDecision);
  await observe(runDeps.observer, {
    agent: "debate",
    type: "run_complete",
    runId,
    branchId: branchIdFromStartInput(startInput),
    payload: {
      debateId: result.debateId,
      status: result.status,
      messageCount: result.messages.length,
      toolEventCount: result.toolEvents.length,
      finalSummaryLength: finalDecision.summary.length,
      finalCitationCount: finalDecision.citations.length,
    },
  });

  const runResult = {
    debateId: result.debateId,
    status: result.status,
    messages: result.messages.map((message) => message),
    toolEvents: result.toolEvents.map((event) =>
      debateToolEventSchema.parse(event),
    ),
    humanInterjections: result.humanInterjections.map((item) =>
      humanInterjectionSchema.parse(item),
    ),
    currentPlan: result.currentPlan,
    finalDecision,
  };
  await runDeps.supermemoryMirror?.mirrorDebateResult({
    result: runResult,
    runId,
    branchId: branchIdFromStartInput(startInput),
    lawId: lawIdFromStartInput(startInput),
  });
  return runResult;
}

function branchIdFromState(state: DebateState): string | undefined {
  return branchIdFromStartInput(state.startInput);
}

function branchIdFromStartInput(
  startInput: ReturnType<typeof debateStartInputSchema.parse>,
): string | undefined {
  const branchId = startInput.basicFinancials.branchId;
  return typeof branchId === "string" ? branchId : undefined;
}

function lawIdFromStartInput(
  startInput: ReturnType<typeof debateStartInputSchema.parse>,
): string | undefined {
  const lawId = startInput.basicFinancials.lawId;
  return typeof lawId === "string" ? lawId : undefined;
}

export async function* streamDebateAgentUpdates(
  config: DebateRunConfig,
  deps: DebateGraphDependencies = {},
) {
  const runId = getAgentRunId("debate", deps.runId);
  const runDeps = { ...deps, runId };
  const startInput = debateStartInputSchema.parse(config.startInput);
  const humanInterjections = (config.humanInterjections ?? []).map((item) =>
    humanInterjectionSchema.parse(item),
  );
  const now = isoNow(runDeps);
  const graph = createDebateGraph(runDeps);
  const budgets = {
    ...defaultDebateBudgets,
    ...config.budgets,
    turnsUsed: 0,
    toolCallsUsed: 0,
  };

  yield* await graph.stream(
    {
      debateId: config.debateId,
      status: "running",
      startInput,
      messages: [],
      toolEvents: [],
      humanInterjections,
      budgets,
      pendingToolRequest: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      configurable: { thread_id: config.debateId },
      streamMode: "updates",
    },
  );
}
