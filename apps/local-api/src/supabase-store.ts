import { randomUUID } from "node:crypto";

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
import type {
  AppendRunEventInput,
  BranchRecord,
  CreateBranchInput,
  CreateRunInput,
  CreateRouterChatInput,
  CreateRouterMessageInput,
  KairosLocalStore,
  RouterChatRecord,
  RouterMessageRecord,
  RunEventRecord,
  RunRecord,
  UpdateBranchInput,
} from "./store.js";

type SupabaseRecordRow<T> = {
  collection: string;
  id: string;
  record: T;
};

export type SupabaseKairosStoreOptions = {
  url?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
};

type Collection =
  | "branches"
  | "runs"
  | "run_events"
  | "router_chats"
  | "router_messages"
  | "messages"
  | "trade_intents"
  | "broker_orders"
  | "portfolio_snapshots";

export class SupabaseKairosStore implements KairosLocalStore {
  private readonly client: SupabaseRecordClient;

  constructor(options: SupabaseKairosStoreOptions = {}) {
    this.client = new SupabaseRecordClient(options);
  }

  async listBranches(): Promise<BranchRecord[]> {
    return sortByCreatedAt(await this.client.list<BranchRecord>("branches"));
  }

  getBranch(id: string): Promise<BranchRecord | undefined> {
    return this.client.get<BranchRecord>("branches", id);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const now = new Date().toISOString();
    const branch: BranchRecord = {
      id: input.id ?? randomUUID(),
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
    await this.client.upsert("branches", branch.id, branch);
    return branch;
  }

  async updateBranch(
    id: string,
    input: UpdateBranchInput,
  ): Promise<BranchRecord | undefined> {
    const current = await this.getBranch(id);
    if (!current) return undefined;

    const branch: BranchRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
    };
    await this.client.upsert("branches", id, branch);
    return branch;
  }

  deleteBranch(id: string): Promise<boolean> {
    return this.client.delete("branches", id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return sortByCreatedAt(await this.client.list<RunRecord>("runs"));
  }

  getRun(id: string): Promise<RunRecord | undefined> {
    return this.client.get<RunRecord>("runs", id);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      status: input.status ?? "pending",
      branchId: input.branchId,
      createdAt: now,
      updatedAt: now,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
    };
    await this.client.upsert("runs", run.id, run);
    return run;
  }

  async updateRun(
    id: string,
    input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>,
  ): Promise<RunRecord | undefined> {
    const current = await this.getRun(id);
    if (!current) return undefined;

    const run: RunRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
    };
    await this.client.upsert("runs", id, run);
    return run;
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    const events = await this.client.list<RunEventRecord>("run_events", {
      "record->>runId": `eq.${runId}`,
    });
    return events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  async appendRunEvent(
    runId: string,
    input: AppendRunEventInput,
  ): Promise<RunEventRecord> {
    const event: RunEventRecord = {
      id: input.id ?? randomUUID(),
      runId,
      type: input.type,
      timestamp: input.timestamp ?? new Date().toISOString(),
      payload: input.payload ?? {},
    };
    await this.client.upsert("run_events", event.id, event);
    return event;
  }

  async listRouterChats(): Promise<RouterChatRecord[]> {
    return sortByCreatedAt(await this.client.list<RouterChatRecord>("router_chats"));
  }

  async createRouterChat(
    input: CreateRouterChatInput = {},
  ): Promise<RouterChatRecord> {
    const now = new Date().toISOString();
    const chat: RouterChatRecord = {
      id: input.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.client.upsert("router_chats", chat.id, chat);
    return chat;
  }

  getRouterChat(id: string): Promise<RouterChatRecord | undefined> {
    return this.client.get<RouterChatRecord>("router_chats", id);
  }

  async listRouterMessages(chatId: string): Promise<RouterMessageRecord[]> {
    const messages = await this.client.list<RouterMessageRecord>("router_messages", {
      "record->>chatId": `eq.${chatId}`,
    });
    return messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createRouterMessage(
    input: CreateRouterMessageInput,
  ): Promise<RouterMessageRecord> {
    const message: RouterMessageRecord = {
      id: input.id ?? randomUUID(),
      chatId: input.chatId,
      role: input.role,
      text: input.text,
      attachments: input.attachments,
      runId: input.runId,
      createdAt: new Date().toISOString(),
    };
    await this.client.upsert("router_messages", message.id, message);

    const chat = await this.getRouterChat(input.chatId);
    if (chat) {
      await this.client.upsert("router_chats", chat.id, {
        ...chat,
        updatedAt: message.createdAt,
      });
    }
    return message;
  }

  async listMessages(): Promise<TradingMessage[]> {
    return sortByCreatedAt(await this.client.list<TradingMessage>("messages"));
  }

  async createMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    const message = createTradingMessageRecord(input);
    await this.client.upsert("messages", message.id, message);
    return message;
  }

  async listTradeIntents(): Promise<TradeIntent[]> {
    return sortByCreatedAt(await this.client.list<TradeIntent>("trade_intents"));
  }

  getTradeIntent(id: string): Promise<TradeIntent | undefined> {
    return this.client.get<TradeIntent>("trade_intents", id);
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    const intent = createTradeIntentRecord(input);
    await this.client.upsert("trade_intents", intent.id, intent);
    return intent;
  }

  async updateTradeIntent(
    id: string,
    input: UpdateTradeIntentInput,
  ): Promise<TradeIntent | undefined> {
    const current = await this.getTradeIntent(id);
    if (!current) return undefined;

    const intent: TradeIntent = {
      ...current,
      ...definedFields(input),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.client.upsert("trade_intents", id, intent);
    return intent;
  }

  async listBrokerOrders(): Promise<BrokerOrder[]> {
    return sortByCreatedAt(await this.client.list<BrokerOrder>("broker_orders"));
  }

  async createBrokerOrder(
    input: CreateBrokerOrderInput | BrokerOrder,
  ): Promise<BrokerOrder> {
    const order =
      "id" in input && "createdAt" in input
        ? input
        : createBrokerOrderRecord(input);
    await this.client.upsert("broker_orders", order.id, order);
    return order;
  }

  async listPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
    return (await this.client.list<PortfolioSnapshot>("portfolio_snapshots")).sort(
      (left, right) => left.capturedAt.localeCompare(right.capturedAt),
    );
  }

  async latestPortfolioSnapshot(): Promise<PortfolioSnapshot | undefined> {
    return (await this.listPortfolioSnapshots()).at(-1);
  }

  async createPortfolioSnapshot(
    input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & {
      id?: string;
      capturedAt?: string;
    },
  ): Promise<PortfolioSnapshot> {
    const snapshot = createPortfolioSnapshotRecord(input);
    await this.client.upsert("portfolio_snapshots", snapshot.id, snapshot);
    return snapshot;
  }
}

class SupabaseRecordClient {
  private readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SupabaseKairosStoreOptions) {
    this.url = (options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
    this.serviceRoleKey =
      options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.url) {
      throw new Error("SUPABASE_URL is required when KAIROS_STORE=supabase.");
    }
    if (!this.serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required when KAIROS_STORE=supabase.",
      );
    }
  }

  async list<T>(
    collection: Collection,
    filters: Record<string, string> = {},
  ): Promise<T[]> {
    const rows = await this.request<Array<SupabaseRecordRow<T>>>(
      "GET",
      this.tableUrl({
        select: "collection,id,record",
        collection: `eq.${collection}`,
        ...filters,
      }),
    );
    return rows.map((row) => row.record);
  }

  async get<T>(collection: Collection, id: string): Promise<T | undefined> {
    const rows = await this.request<Array<SupabaseRecordRow<T>>>(
      "GET",
      this.tableUrl({
        select: "collection,id,record",
        collection: `eq.${collection}`,
        id: `eq.${id}`,
        limit: "1",
      }),
    );
    return rows[0]?.record;
  }

  async upsert<T>(collection: Collection, id: string, record: T): Promise<void> {
    await this.request("POST", this.tableUrl({ on_conflict: "collection,id" }), {
      body: JSON.stringify({
        collection,
        id,
        record,
        updated_at: new Date().toISOString(),
      }),
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
    });
  }

  async delete(collection: Collection, id: string): Promise<boolean> {
    const rows = await this.request<Array<SupabaseRecordRow<unknown>>>(
      "DELETE",
      this.tableUrl({
        select: "collection,id,record",
        collection: `eq.${collection}`,
        id: `eq.${id}`,
      }),
      {
        headers: {
          Prefer: "return=representation",
        },
      },
    );
    return rows.length > 0;
  }

  private tableUrl(params: Record<string, string>): URL {
    const url = new URL(`${this.url}/rest/v1/kairos_records`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private async request<T>(
    method: string,
    url: URL,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      method,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase request failed: ${response.status} ${body}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function sortByCreatedAt<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
