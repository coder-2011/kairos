import type { GlobalToolRegistry } from "../../global/tools.js";
import type { AgentObserver } from "../../global/observability.js";

export type DebateAgentName = "judge" | "bull" | "bear" | "tool_agent";

export type DebateMessageType = "argument" | "plan" | "tool_result" | "final";

export type DebateStatus = "running" | "completed" | "failed";

export type DebateToolName = "exa_search" | "exa_research" | "information";

export type Citation = {
  title?: string;
  url: string;
  source?: string;
};

export type BasicFinancials = Record<string, unknown>;

export type DebateStartInput = {
  summary: string;
  basicFinancials: BasicFinancials;
};

export type DebateMessage = {
  agentName: DebateAgentName;
  messageType: DebateMessageType;
  argument: string;
  confidence?: number;
};

export type HumanInterjection = {
  timestamp: string;
  summary: string;
};

export type DebateDecision = {
  summary: string;
  confidence: number;
  citations: Citation[];
};

export type DebateToolRequest = {
  toolName: DebateToolName;
  input: string;
};

export type DebateToolEvent = {
  toolEventId: string;
  debateId: string;
  toolName: DebateToolName;
  requestedBy: "judge" | "bull" | "bear";
  input: string;
  summary: string;
  outputRef?: string;
  citations: Citation[];
  status: "started" | "completed" | "failed";
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export type JudgeNextNode = "bull" | "bear" | "final";

export type JudgePlan = {
  plan: string;
  nextNode: JudgeNextNode;
};

export type DebateAgentOutput = {
  argument: string;
  confidence?: number;
  toolRequest?: DebateToolRequest | null;
};

export type DebateToolResult = {
  summary: string;
  citations?: Citation[];
  outputRef?: string;
};

export type DebateTool = (
  input: string,
  context: {
    debateId: string;
    requestedBy: "judge" | "bull" | "bear";
    startInput: DebateStartInput;
  },
) => Promise<DebateToolResult>;

export type DebateTools = Partial<Record<DebateToolName, DebateTool>>;

export type StructuredDebateModel<T> = {
  invoke: (input: unknown) => Promise<T>;
};

export type StructuredDebateModelProvider = {
  withStructuredOutput: <T>(schema: unknown) => StructuredDebateModel<T>;
};

export type DebateModelSet = {
  judge?: StructuredDebateModelProvider;
  bull?: StructuredDebateModelProvider;
  bear?: StructuredDebateModelProvider;
  final?: StructuredDebateModelProvider;
};

export type DebateBudgets = {
  maxTurns: number;
  maxToolCalls: number;
};

export type DebateBudgetState = DebateBudgets & {
  turnsUsed: number;
  toolCallsUsed: number;
};

export type DebateRunConfig = {
  debateId: string;
  startInput: DebateStartInput;
  humanInterjections?: HumanInterjection[];
  budgets?: Partial<DebateBudgets>;
};

export type DebateRunResult = {
  debateId: string;
  status: DebateStatus;
  messages: DebateMessage[];
  toolEvents: DebateToolEvent[];
  humanInterjections: HumanInterjection[];
  currentPlan?: JudgePlan;
  finalDecision: DebateDecision;
};

export type DebateGraphDependencies = {
  models?: DebateModelSet;
  tools?: DebateTools;
  globalTools?: GlobalToolRegistry;
  now?: () => Date;
  id?: () => string;
  observer?: AgentObserver;
  runId?: string;
};

export type PendingToolRequest = DebateToolRequest & {
  requestedBy: "judge" | "bull" | "bear";
};
