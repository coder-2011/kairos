import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

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
  const citations = state.toolEvents.flatMap((event) => event.citations);
  return {
    summary: `Final synthesis based on ${state.messages.length} messages and ${state.toolEvents.length} tool result(s).`,
    confidence: 0.5,
    citations,
  };
}

export function createDebateGraph(deps: DebateGraphDependencies = {}) {
  const judgeNode = async (
    state: DebateState,
  ): Promise<{
    currentPlan: JudgePlan;
    messages: DebateMessage[];
    pendingToolRequest: null;
    updatedAt: string;
  }> => {
    const rawPlan = deps.models?.judge
      ? await invokeStructured<JudgePlan>(
          deps.models.judge,
          judgePlanSchema,
          buildModelInput(state, JUDGE_SYSTEM_PROMPT),
        )
      : deterministicJudgePlan(state);
    const plan = judgePlanSchema.parse(rawPlan);

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
      const rawOutput = deps.models?.[role]
        ? await invokeStructured<DebateAgentOutput>(
            deps.models[role],
            debateAgentOutputSchema,
            buildModelInput(state, systemPrompt),
          )
        : deterministicAgentOutput(role, state);
      const output = debateAgentOutputSchema.parse(rawOutput);
      const toolRequest =
        output.toolRequest &&
        state.budgets.toolCallsUsed < state.budgets.maxToolCalls
          ? { ...output.toolRequest, requestedBy: role }
          : null;

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
    const tool = deps.tools?.[state.pendingToolRequest.toolName];

    try {
      const result = tool
        ? await tool(state.pendingToolRequest.input, {
            debateId: state.debateId,
            requestedBy: state.pendingToolRequest.requestedBy,
            startInput: state.startInput,
          })
        : {
            summary: `Stub ${state.pendingToolRequest.toolName} result for: ${state.pendingToolRequest.input}`,
            citations: [],
          };

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
    const rawDecision = deps.models?.final
      ? await invokeStructured<DebateDecision>(
          deps.models.final,
          debateDecisionSchema,
          buildModelInput(state, FINAL_SYSTEM_PROMPT),
        )
      : deterministicFinalDecision(state);
    const decision = debateDecisionSchema.parse(rawDecision);

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
    .addNode("bull", createDebateParticipantNode("bull", BULL_SYSTEM_PROMPT))
    .addNode("bear", createDebateParticipantNode("bear", BEAR_SYSTEM_PROMPT))
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
  const startInput = debateStartInputSchema.parse(config.startInput);
  const humanInterjections = (config.humanInterjections ?? []).map((item) =>
    humanInterjectionSchema.parse(item),
  );
  const now = isoNow(deps);
  const graph = createDebateGraph(deps);
  const budgets = {
    ...defaultDebateBudgets,
    ...config.budgets,
    turnsUsed: 0,
    toolCallsUsed: 0,
  };

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

  return {
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
}

export async function* streamDebateAgentUpdates(
  config: DebateRunConfig,
  deps: DebateGraphDependencies = {},
) {
  const startInput = debateStartInputSchema.parse(config.startInput);
  const humanInterjections = (config.humanInterjections ?? []).map((item) =>
    humanInterjectionSchema.parse(item),
  );
  const now = isoNow(deps);
  const graph = createDebateGraph(deps);
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
