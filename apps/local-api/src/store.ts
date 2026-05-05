import type {
  KairosBranchAgentConfig,
  KairosReasoningEffort,
} from "../../../src/global/agent-config.js";
import {
  createBrokerOrderRecord,
  createPortfolioSnapshotRecord,
  createTradeIntentRecord,
  createTradingMessageRecord,
  type BrokerOrder,
  type CreateBrokerOrderInput,
  type CreateTradeIntentInput,
  type CreateTradingMessageInput,
  type PortfolioSnapshot,
  type TradeIntent,
  type TradingMessage,
  type UpdateTradeIntentInput,
} from "../../../src/trading/index.js";

export type JsonRecord = Record<string, unknown>;

export type BranchRecord = {
  id: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  law?: JsonRecord;
  config?: KairosBranchAgentConfig;
  metadata?: JsonRecord;
};

export type RunKind = "heartbeat" | "debate" | "router" | "deep_research" | "broker_sync";
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export type RunLifecycle = {
  stage: string;
  lastEventAt?: string;
  elapsedMs: number;
  currentOperation?: string;
  childRunIds: string[];
  parentRunId?: string;
  blockingExternalService?: string;
  retryable: boolean;
  cancelable: boolean;
};

export type RunRecord = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  branchId?: string;
  createdAt: string;
  updatedAt: string;
  input: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
  lifecycle?: RunLifecycle;
};

export type RunEventRecord = {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  payload: JsonRecord;
};

export type RouterAttachmentRecord = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
};

export type RouterChatRecord = {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type RouterMessageRecord = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  createdAt: string;
  text?: string;
  attachments?: RouterAttachmentRecord[];
  runId?: string;
  toolCalls?: RouterToolCallRecord[];
};

export type RouterToolCallRecord = {
  id: string;
  name: string;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  input?: JsonRecord;
  output?: JsonRecord;
  error?: string;
  createdAt: string;
};

export type DeepResearchChatRecord = {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeepResearchImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type DeepResearchMessageRecord = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  createdAt: string;
  text?: string;
  model?: string;
  reasoning?: string;
  reasoningEffort?: KairosReasoningEffort;
  attachments?: DeepResearchImageAttachment[];
  toolCalls?: RouterToolCallRecord[];
};

export type CreateBranchInput = {
  id?: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  law?: JsonRecord;
  config?: KairosBranchAgentConfig;
  metadata?: JsonRecord;
};

export type UpdateBranchInput = Partial<Omit<CreateBranchInput, "id">>;

export type CreateRunInput = {
  id?: string;
  kind: RunKind;
  status?: RunStatus;
  branchId?: string;
  input?: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
  lifecycle?: RunLifecycle;
};

export type AppendRunEventInput = {
  id?: string;
  type: string;
  timestamp?: string;
  payload?: JsonRecord;
};

export type CreateRouterChatInput = {
  id?: string;
  title?: string;
};

export type CreateRouterMessageInput = {
  id?: string;
  chatId: string;
  role: "user" | "assistant";
  text?: string;
  chatTitle?: string;
  attachments?: RouterAttachmentRecord[];
  runId?: string;
  toolCalls?: RouterToolCallRecord[];
};

export type CreateDeepResearchChatInput = {
  id?: string;
  title?: string;
};

export type CreateDeepResearchMessageInput = {
  id?: string;
  chatId: string;
  role: "user" | "assistant";
  text?: string;
  chatTitle?: string;
  model?: string;
  reasoning?: string;
  reasoningEffort?: KairosReasoningEffort;
  attachments?: DeepResearchImageAttachment[];
  toolCalls?: RouterToolCallRecord[];
};

export type RunEventSubscriber = (event: RunEventRecord) => void;

export type ApiControlRecord = {
  id: string;
  kind: "rate_limit_hit" | "idempotency_response" | "job_lease" | "telegram_binding" | "telegram_update";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  data?: JsonRecord;
};

export type KairosLocalStore = {
  listBranches(): Promise<BranchRecord[]>;
  getBranch(id: string): Promise<BranchRecord | undefined>;
  createBranch(input: CreateBranchInput): Promise<BranchRecord>;
  updateBranch(id: string, input: UpdateBranchInput): Promise<BranchRecord | undefined>;
  deleteBranch(id: string): Promise<boolean>;
  listRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | undefined>;
  createRun(input: CreateRunInput): Promise<RunRecord>;
  updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata" | "lifecycle">>): Promise<RunRecord | undefined>;
  listRunEvents(runId: string): Promise<RunEventRecord[]>;
  appendRunEvent(runId: string, input: AppendRunEventInput): Promise<RunEventRecord>;
  subscribeToRunEvents?(runId: string, subscriber: RunEventSubscriber): () => void;
  listRouterChats(): Promise<RouterChatRecord[]>;
  deleteRouterChat(id: string): Promise<boolean>;
  createRouterChat(input?: CreateRouterChatInput): Promise<RouterChatRecord>;
  getRouterChat(id: string): Promise<RouterChatRecord | undefined>;
  listRouterMessages(chatId: string): Promise<RouterMessageRecord[]>;
  createRouterMessage(input: CreateRouterMessageInput): Promise<RouterMessageRecord>;
  listDeepResearchChats(): Promise<DeepResearchChatRecord[]>;
  deleteDeepResearchChat(id: string): Promise<boolean>;
  createDeepResearchChat(input?: CreateDeepResearchChatInput): Promise<DeepResearchChatRecord>;
  getDeepResearchChat(id: string): Promise<DeepResearchChatRecord | undefined>;
  listDeepResearchMessages(chatId: string): Promise<DeepResearchMessageRecord[]>;
  createDeepResearchMessage(input: CreateDeepResearchMessageInput): Promise<DeepResearchMessageRecord>;
  listMessages(): Promise<TradingMessage[]>;
  createMessage(input: CreateTradingMessageInput): Promise<TradingMessage>;
  listTradeIntents(): Promise<TradeIntent[]>;
  getTradeIntent(id: string): Promise<TradeIntent | undefined>;
  createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent>;
  updateTradeIntent(id: string, input: UpdateTradeIntentInput): Promise<TradeIntent | undefined>;
  listBrokerOrders(): Promise<BrokerOrder[]>;
  createBrokerOrder(input: CreateBrokerOrderInput | BrokerOrder): Promise<BrokerOrder>;
  listPortfolioSnapshots(): Promise<PortfolioSnapshot[]>;
  latestPortfolioSnapshot(): Promise<PortfolioSnapshot | undefined>;
  createPortfolioSnapshot(input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & { id?: string; capturedAt?: string }): Promise<PortfolioSnapshot>;
  listApiControlRecords?(input?: { kind?: ApiControlRecord["kind"]; idPrefix?: string }): Promise<ApiControlRecord[]>;
  getApiControlRecord?(id: string): Promise<ApiControlRecord | undefined>;
  upsertApiControlRecord?(record: ApiControlRecord): Promise<ApiControlRecord>;
  deleteExpiredApiControlRecords?(now?: string): Promise<number>;
};

export class MemoryKairosStore implements KairosLocalStore {
  private branches = new Map<string, BranchRecord>();
  private runs = new Map<string, RunRecord>();
  private events = new Map<string, RunEventRecord[]>();
  private routerChats = new Map<string, RouterChatRecord>();
  private routerMessages = new Map<string, RouterMessageRecord[]>();
  private deepResearchChats = new Map<string, DeepResearchChatRecord>();
  private deepResearchMessages = new Map<string, DeepResearchMessageRecord[]>();
  private messages = new Map<string, TradingMessage>();
  private tradeIntents = new Map<string, TradeIntent>();
  private brokerOrders = new Map<string, BrokerOrder>();
  private portfolioSnapshots = new Map<string, PortfolioSnapshot>();
  private apiControlRecords = new Map<string, ApiControlRecord>();
  private subscribers = new Map<string, Set<RunEventSubscriber>>();
  private sequence = 0;

  async listBranches(): Promise<BranchRecord[]> {
    return sortByCreatedAt([...this.branches.values()]);
  }

  async getBranch(id: string): Promise<BranchRecord | undefined> {
    return this.branches.get(id);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? this.nextId("branch");
    const branch: BranchRecord = {
      id,
      lawId: input.lawId,
      name: input.name,
      description: input.description,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      law: input.law,
      config: input.config,
      metadata: input.metadata,
    };
    this.branches.set(id, branch);
    return branch;
  }

  async updateBranch(id: string, input: UpdateBranchInput): Promise<BranchRecord | undefined> {
    const current = this.branches.get(id);
    if (!current) return undefined;

    const branch: BranchRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(id, branch);
    return branch;
  }

  async deleteBranch(id: string): Promise<boolean> {
    return this.branches.delete(id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return sortByCreatedAt([...this.runs.values()]);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? this.nextId(input.kind);
    const status = input.status ?? "pending";
    const run: RunRecord = {
      id,
      kind: input.kind,
      status,
      branchId: input.branchId,
      createdAt: now,
      updatedAt: now,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
      lifecycle: normalizeRunLifecycle(
        {
          ...input.lifecycle,
          parentRunId:
            input.lifecycle?.parentRunId ??
            readString(input.metadata?.parentRunId) ??
            readString(input.input?.sourceRunId),
        },
        { createdAt: now, updatedAt: now, kind: input.kind, status },
      ),
    };
    this.runs.set(id, run);
    this.linkParentRun(run);
    return run;
  }

  async updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata" | "lifecycle">>): Promise<RunRecord | undefined> {
    const current = this.runs.get(id);
    if (!current) return undefined;
    const nextStatus = input.status ?? current.status;
    if (current.status === "canceled" && nextStatus !== "canceled") {
      return current;
    }

    const now = new Date().toISOString();
    const status = nextStatus;
    const run: RunRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: now,
      lifecycle: normalizeRunLifecycle(
        {
          ...current.lifecycle,
          ...input.lifecycle,
          ...lifecyclePatchForStatus(status),
        },
        { createdAt: current.createdAt, updatedAt: now, kind: current.kind, status },
      ),
    };
    this.runs.set(id, run);
    return run;
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return [...(this.events.get(runId) ?? [])];
  }

  async appendRunEvent(runId: string, input: AppendRunEventInput): Promise<RunEventRecord> {
    const event: RunEventRecord = {
      id: input.id ?? this.nextId("event"),
      runId,
      type: input.type,
      timestamp: input.timestamp ?? new Date().toISOString(),
      payload: input.payload ?? {},
    };
    const events = this.events.get(runId) ?? [];
    events.push(event);
    this.events.set(runId, events);
    this.updateRunLifecycleFromEvent(runId, event);

    for (const subscriber of this.subscribers.get(runId) ?? []) {
      subscriber(event);
    }
    return event;
  }

  subscribeToRunEvents(runId: string, subscriber: RunEventSubscriber): () => void {
    const subscribers = this.subscribers.get(runId) ?? new Set<RunEventSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(runId, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  async listRouterChats(): Promise<RouterChatRecord[]> {
    return sortByCreatedAt(
      [...this.routerChats.values()].map((chat) => ({
        ...chat,
        title: chat.title ?? buildRouterChatTitle(
          firstUserMessage(this.routerMessages.get(chat.id)) ?? {},
        ),
      })),
    );
  }

  async createRouterChat(input: CreateRouterChatInput = {}): Promise<RouterChatRecord> {
    const now = new Date().toISOString();
    const chat: RouterChatRecord = {
      id: input.id ?? this.nextId("router_chat"),
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
    this.routerChats.set(chat.id, chat);
    return chat;
  }

  async deleteRouterChat(id: string): Promise<boolean> {
    const deleted = this.routerChats.delete(id);
    this.routerMessages.delete(id);
    return deleted;
  }

  async getRouterChat(id: string): Promise<RouterChatRecord | undefined> {
    return this.routerChats.get(id);
  }

  async listRouterMessages(chatId: string): Promise<RouterMessageRecord[]> {
    return [...(this.routerMessages.get(chatId) ?? [])];
  }

  async createRouterMessage(input: CreateRouterMessageInput): Promise<RouterMessageRecord> {
    const message: RouterMessageRecord = {
      id: input.id ?? this.nextId("router_message"),
      chatId: input.chatId,
      role: input.role,
      text: input.text,
      attachments: input.attachments,
      runId: input.runId,
      toolCalls: input.toolCalls,
      createdAt: new Date().toISOString(),
    };
    const messages = this.routerMessages.get(input.chatId) ?? [];
    messages.push(message);
    this.routerMessages.set(input.chatId, messages);

    const chat = this.routerChats.get(input.chatId);
    if (chat) {
      this.routerChats.set(input.chatId, {
        ...chat,
        title: chat.title ?? input.chatTitle ?? buildRouterChatTitle(input),
        updatedAt: message.createdAt,
      });
    }
    return message;
  }

  async listDeepResearchChats(): Promise<DeepResearchChatRecord[]> {
    return [...this.deepResearchChats.values()].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  }

  async createDeepResearchChat(input: CreateDeepResearchChatInput = {}): Promise<DeepResearchChatRecord> {
    const now = new Date().toISOString();
    const chat: DeepResearchChatRecord = {
      id: input.id ?? this.nextId("deep_research_chat"),
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
    this.deepResearchChats.set(chat.id, chat);
    return chat;
  }

  async deleteDeepResearchChat(id: string): Promise<boolean> {
    const deleted = this.deepResearchChats.delete(id);
    this.deepResearchMessages.delete(id);
    return deleted;
  }

  async getDeepResearchChat(id: string): Promise<DeepResearchChatRecord | undefined> {
    return this.deepResearchChats.get(id);
  }

  async listDeepResearchMessages(chatId: string): Promise<DeepResearchMessageRecord[]> {
    return [...(this.deepResearchMessages.get(chatId) ?? [])];
  }

  async createDeepResearchMessage(input: CreateDeepResearchMessageInput): Promise<DeepResearchMessageRecord> {
    const message: DeepResearchMessageRecord = {
      id: input.id ?? this.nextId("deep_research_message"),
      chatId: input.chatId,
      role: input.role,
      text: input.text,
      model: input.model,
      reasoning: input.reasoning,
      reasoningEffort: input.reasoningEffort,
      attachments: input.attachments,
      toolCalls: input.toolCalls,
      createdAt: new Date().toISOString(),
    };
    const messages = this.deepResearchMessages.get(input.chatId) ?? [];
    messages.push(message);
    this.deepResearchMessages.set(input.chatId, messages);

    const chat = this.deepResearchChats.get(input.chatId);
    if (chat) {
      const nextTitle = chat.title ??
        input.chatTitle ??
        (input.role === "user" ? buildRouterChatTitle({ text: input.text }) : undefined);
      this.deepResearchChats.set(input.chatId, {
        ...chat,
        ...(nextTitle ? { title: nextTitle } : {}),
        updatedAt: message.createdAt,
      });
    }
    return message;
  }

  async listMessages(): Promise<TradingMessage[]> {
    return sortByCreatedAt([...this.messages.values()]);
  }

  async createMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    const message = createTradingMessageRecord(input, {
      id: () => this.nextId("message"),
    });
    this.messages.set(message.id, message);
    return message;
  }

  async listTradeIntents(): Promise<TradeIntent[]> {
    return sortByCreatedAt([...this.tradeIntents.values()]);
  }

  async getTradeIntent(id: string): Promise<TradeIntent | undefined> {
    return this.tradeIntents.get(id);
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    const intent = createTradeIntentRecord(input, {
      id: () => this.nextId("trade_intent"),
    });
    this.tradeIntents.set(intent.id, intent);
    return intent;
  }

  async updateTradeIntent(id: string, input: UpdateTradeIntentInput): Promise<TradeIntent | undefined> {
    const current = this.tradeIntents.get(id);
    if (!current) return undefined;

    const intent: TradeIntent = {
      ...current,
      ...definedFields(input),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.tradeIntents.set(id, intent);
    return intent;
  }

  async listBrokerOrders(): Promise<BrokerOrder[]> {
    return sortByCreatedAt([...this.brokerOrders.values()]);
  }

  async createBrokerOrder(input: CreateBrokerOrderInput | BrokerOrder): Promise<BrokerOrder> {
    const order = "id" in input && "createdAt" in input
      ? input
      : createBrokerOrderRecord(input, { id: () => this.nextId("broker_order") });
    this.brokerOrders.set(order.id, order);
    return order;
  }

  async listPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
    return [...this.portfolioSnapshots.values()].sort((left, right) =>
      left.capturedAt.localeCompare(right.capturedAt),
    );
  }

  async latestPortfolioSnapshot(): Promise<PortfolioSnapshot | undefined> {
    return (await this.listPortfolioSnapshots()).at(-1);
  }

  async createPortfolioSnapshot(
    input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & { id?: string; capturedAt?: string },
  ): Promise<PortfolioSnapshot> {
    const snapshot = createPortfolioSnapshotRecord(input, {
      id: () => this.nextId("portfolio"),
    });
    this.portfolioSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listApiControlRecords(input: {
    kind?: ApiControlRecord["kind"];
    idPrefix?: string;
  } = {}): Promise<ApiControlRecord[]> {
    return [...this.apiControlRecords.values()]
      .filter((record) => !input.kind || record.kind === input.kind)
      .filter((record) => !input.idPrefix || record.id.startsWith(input.idPrefix))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getApiControlRecord(id: string): Promise<ApiControlRecord | undefined> {
    return this.apiControlRecords.get(id);
  }

  async upsertApiControlRecord(record: ApiControlRecord): Promise<ApiControlRecord> {
    this.apiControlRecords.set(record.id, record);
    return record;
  }

  async deleteExpiredApiControlRecords(now = new Date().toISOString()): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.apiControlRecords) {
      if (record.expiresAt && record.expiresAt <= now) {
        this.apiControlRecords.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
  }

  private updateRunLifecycleFromEvent(runId: string, event: RunEventRecord): void {
    const current = this.runs.get(runId);
    if (!current) return;

    this.runs.set(runId, {
      ...current,
      updatedAt: event.timestamp,
      lifecycle: normalizeRunLifecycle(
        {
          ...current.lifecycle,
          ...lifecyclePatchForEvent(event),
          lastEventAt: event.timestamp,
        },
        {
          createdAt: current.createdAt,
          updatedAt: event.timestamp,
          kind: current.kind,
          status: current.status,
        },
      ),
    });
  }

  private linkParentRun(run: RunRecord): void {
    const parentRunId = run.lifecycle?.parentRunId;
    if (!parentRunId) return;

    const parent = this.runs.get(parentRunId);
    if (!parent) return;

    this.runs.set(parentRunId, {
      ...parent,
      lifecycle: normalizeRunLifecycle(
        {
          ...parent.lifecycle,
          childRunIds: uniqueStrings([
            ...(parent.lifecycle?.childRunIds ?? []),
            run.id,
          ]),
        },
        {
          createdAt: parent.createdAt,
          updatedAt: parent.updatedAt,
          kind: parent.kind,
          status: parent.status,
        },
      ),
    });
  }
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

export function normalizeRunLifecycle(
  lifecycle: Partial<RunLifecycle> | undefined,
  run: Pick<RunRecord, "createdAt" | "updatedAt" | "kind" | "status">,
): RunLifecycle {
  const baseStage = run.status === "running" ? "running" : run.status;
  return {
    stage: lifecycle?.stage ?? baseStage,
    lastEventAt: lifecycle?.lastEventAt,
    elapsedMs: Math.max(
      0,
      Date.parse(lifecycle?.lastEventAt ?? run.updatedAt) - Date.parse(run.createdAt),
    ),
    currentOperation:
      lifecycle?.currentOperation ??
      defaultCurrentOperation(run.kind, lifecycle?.stage ?? baseStage),
    childRunIds: uniqueStrings(lifecycle?.childRunIds ?? []),
    parentRunId: lifecycle?.parentRunId,
    blockingExternalService: lifecycle?.blockingExternalService,
    retryable: lifecycle?.retryable ?? run.status === "failed",
    cancelable: lifecycle?.cancelable ?? run.status === "running",
  };
}

export function lifecyclePatchForEvent(
  event: Pick<RunEventRecord, "type" | "payload">,
): Partial<RunLifecycle> {
  const service = blockingExternalServiceForEvent(event);
  const patch = lifecycleStageForEvent(event.type);
  return {
    ...patch,
    ...(service ? { blockingExternalService: service } : {}),
  };
}

export function lifecyclePatchForStatus(status: RunStatus): Partial<RunLifecycle> {
  if (status === "succeeded") {
    return {
      stage: "completed",
      currentOperation: "Run completed.",
      blockingExternalService: undefined,
      retryable: false,
      cancelable: false,
    };
  }
  if (status === "failed") {
    return {
      stage: "failed",
      currentOperation: "Run failed.",
      retryable: true,
      cancelable: false,
    };
  }
  if (status === "canceled") {
    return {
      stage: "canceled",
      currentOperation: "Run canceled.",
      retryable: true,
      cancelable: false,
    };
  }
  if (status === "running") {
    return { stage: "running", retryable: false, cancelable: true };
  }
  return { stage: "pending", retryable: false, cancelable: false };
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function lifecycleStageForEvent(type: string): Partial<RunLifecycle> {
  const stages: Record<string, Partial<RunLifecycle>> = {
    "run.started": { stage: "started", currentOperation: "Run started." },
    "run.completed": { stage: "completed", currentOperation: "Run completed.", retryable: false, cancelable: false },
    "run.failed": { stage: "failed", currentOperation: "Run failed.", retryable: true, cancelable: false },
    "run.canceled": { stage: "canceled", currentOperation: "Run canceled.", retryable: true, cancelable: false },
    "heartbeat.seeded": { stage: "seeded", currentOperation: "Built heartbeat seed bundle." },
    "heartbeat.tool.completed": { stage: "tool_step", currentOperation: "Heartbeat tool call completed." },
    "heartbeat.tool.failed": { stage: "tool_step_failed", currentOperation: "Heartbeat tool call failed.", retryable: true },
    "heartbeat.decision": { stage: "decision", currentOperation: "Heartbeat decision recorded." },
    "router.message.received": { stage: "input_received", currentOperation: "Router received the source packet." },
    "router.sources.extracted": { stage: "sources_extracted", currentOperation: "Router extracted source text." },
    "router.sources.mirrored": { stage: "memory_mirrored", currentOperation: "Router mirrored sources to memory." },
    "router.route.selected": { stage: "branches_selected", currentOperation: "Router selected matching branches." },
    "router.heartbeat_triggered": { stage: "heartbeat_wakeup", currentOperation: "Router woke a branch heartbeat." },
    "router.heartbeat_failed": { stage: "heartbeat_wakeup_failed", currentOperation: "Router heartbeat wakeup failed.", retryable: true },
    "router.response.created": { stage: "response_created", currentOperation: "Router response created." },
    "debate.created": { stage: "debate_created", currentOperation: "Debate run packet created." },
    "debate.started": { stage: "debate_started", currentOperation: "Debate started." },
    "judge.plan.started": { stage: "judge_plan_started", currentOperation: "Judge is selecting the next debate step." },
    "model.call.started": { stage: "model_call_started", currentOperation: "Model call started." },
    "model.call.completed": { stage: "model_call_completed", currentOperation: "Model call completed." },
    "debate.message": { stage: "debate_turn", currentOperation: "Debate participant responded." },
    "participant.responded": { stage: "participant_responded", currentOperation: "Debate participant responded." },
    "tool.call.started": { stage: "tool_call_started", currentOperation: "Tool call started." },
    "debate.tool.completed": { stage: "debate_tool", currentOperation: "Debate tool call completed." },
    "debate.tool.failed": { stage: "debate_tool_failed", currentOperation: "Debate tool call failed.", retryable: true },
    "final.synthesis.started": { stage: "final_synthesis_started", currentOperation: "Final debate synthesis started." },
    "debate.completed": { stage: "debate_completed", currentOperation: "Debate completed.", retryable: false, cancelable: false },
    "debate.judge.plan": { stage: "judge_plan", currentOperation: "Judge selected the next debate step." },
    "debate.judge.summary": { stage: "judge_summary", currentOperation: "Judge produced final synthesis." },
    "debate.output": { stage: "debate_output", currentOperation: "Debate output recorded." },
    "debate.failed": { stage: "debate_failed", currentOperation: "Debate failed.", retryable: true, cancelable: false },
    "trading.threshold.evaluated": { stage: "trading_policy", currentOperation: "Trading threshold policy evaluated." },
    "trading.policy.skipped": { stage: "trading_policy_skipped", currentOperation: "Trading policy did not create an action." },
    "trading.intent.created": { stage: "trade_intent_created", currentOperation: "Trade intent created." },
    "trading.intent.submitted": { stage: "paper_order_submitted", currentOperation: "Order submitted." },
    "trading.intent.failed": { stage: "paper_order_failed", currentOperation: "Order failed.", retryable: true },
    "human.interjection": { stage: "human_context_added", currentOperation: "Human context added." },
  };

  if (type === "router.tool_call.completed") {
    return { stage: "router_tool", currentOperation: "Router tool call completed." };
  }
  if (type === "router.tool_call.failed") {
    return { stage: "router_tool_failed", currentOperation: "Router tool call failed.", retryable: true };
  }

  return stages[type] ?? {
    stage: type.replaceAll(".", "_"),
    currentOperation: humanizeEventType(type),
  };
}

function blockingExternalServiceForEvent(
  event: Pick<RunEventRecord, "type" | "payload">,
): string | undefined {
  const errorText = JSON.stringify(event.payload).toLowerCase();
  if (event.type.includes("supermemory") || errorText.includes("supermemory")) return "supermemory";
  if (event.type.includes("exa") || errorText.includes("exa")) return "exa";
  if (event.type.includes("alpaca") || errorText.includes("alpaca")) return "alpaca";
  if (event.type.includes("finnhub") || errorText.includes("finnhub")) return "finnhub";
  if (event.type.includes("telegram") || errorText.includes("telegram")) return "telegram";
  if (event.type.includes("tool.failed") || event.type.includes("tool_call.failed")) return "external_tool";
  if (errorText.includes("openrouter") || errorText.includes("model")) return "openrouter";
  return undefined;
}

function defaultCurrentOperation(kind: RunKind, stage: string): string {
  if (stage === "pending") return "Waiting to start.";
  if (stage === "running") return `${kind} workflow is running.`;
  return humanizeEventType(stage);
}

function humanizeEventType(type: string): string {
  return `${type.replace(/[._-]+/g, " ")}.`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function sortByCreatedAt<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function buildRouterChatTitle(input: {
  text?: string;
  attachments?: RouterAttachmentRecord[];
}): string | undefined {
  const text = input.text
    ?.replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const attachmentName = input.attachments?.[0]?.name;
  const title = text || (attachmentName ? `Attachment: ${attachmentName}` : undefined);
  if (!title) return undefined;
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}...` : title;
}

function firstUserMessage(
  messages: Array<{ role: string; text?: string; attachments?: RouterAttachmentRecord[] }> | undefined,
): { role: string; text?: string; attachments?: RouterAttachmentRecord[] } | undefined {
  return messages?.find((message) => message.role === "user");
}
