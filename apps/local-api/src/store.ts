import type { KairosBranchAgentConfig } from "../../../src/global/agent-config.js";
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

export type RunKind = "heartbeat" | "debate" | "router";
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

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
};

export type AppendRunEventInput = {
  id?: string;
  type: string;
  timestamp?: string;
  payload?: JsonRecord;
};

export type CreateRouterChatInput = {
  id?: string;
};

export type CreateRouterMessageInput = {
  id?: string;
  chatId: string;
  role: "user" | "assistant";
  text?: string;
  attachments?: RouterAttachmentRecord[];
  runId?: string;
  toolCalls?: RouterToolCallRecord[];
};

export type RunEventSubscriber = (event: RunEventRecord) => void;

export type KairosLocalStore = {
  listBranches(): Promise<BranchRecord[]>;
  getBranch(id: string): Promise<BranchRecord | undefined>;
  createBranch(input: CreateBranchInput): Promise<BranchRecord>;
  updateBranch(id: string, input: UpdateBranchInput): Promise<BranchRecord | undefined>;
  deleteBranch(id: string): Promise<boolean>;
  listRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | undefined>;
  createRun(input: CreateRunInput): Promise<RunRecord>;
  updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>): Promise<RunRecord | undefined>;
  listRunEvents(runId: string): Promise<RunEventRecord[]>;
  appendRunEvent(runId: string, input: AppendRunEventInput): Promise<RunEventRecord>;
  subscribeToRunEvents?(runId: string, subscriber: RunEventSubscriber): () => void;
  listRouterChats(): Promise<RouterChatRecord[]>;
  createRouterChat(input?: CreateRouterChatInput): Promise<RouterChatRecord>;
  getRouterChat(id: string): Promise<RouterChatRecord | undefined>;
  listRouterMessages(chatId: string): Promise<RouterMessageRecord[]>;
  createRouterMessage(input: CreateRouterMessageInput): Promise<RouterMessageRecord>;
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
};

export class MemoryKairosStore implements KairosLocalStore {
  private branches = new Map<string, BranchRecord>();
  private runs = new Map<string, RunRecord>();
  private events = new Map<string, RunEventRecord[]>();
  private routerChats = new Map<string, RouterChatRecord>();
  private routerMessages = new Map<string, RouterMessageRecord[]>();
  private messages = new Map<string, TradingMessage>();
  private tradeIntents = new Map<string, TradeIntent>();
  private brokerOrders = new Map<string, BrokerOrder>();
  private portfolioSnapshots = new Map<string, PortfolioSnapshot>();
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
    const run: RunRecord = {
      id,
      kind: input.kind,
      status: input.status ?? "pending",
      branchId: input.branchId,
      createdAt: now,
      updatedAt: now,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
    };
    this.runs.set(id, run);
    return run;
  }

  async updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>): Promise<RunRecord | undefined> {
    const current = this.runs.get(id);
    if (!current) return undefined;

    const run: RunRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
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
    return sortByCreatedAt([...this.routerChats.values()]);
  }

  async createRouterChat(input: CreateRouterChatInput = {}): Promise<RouterChatRecord> {
    const now = new Date().toISOString();
    const chat: RouterChatRecord = {
      id: input.id ?? this.nextId("router_chat"),
      createdAt: now,
      updatedAt: now,
    };
    this.routerChats.set(chat.id, chat);
    return chat;
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

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
  }
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function sortByCreatedAt<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
