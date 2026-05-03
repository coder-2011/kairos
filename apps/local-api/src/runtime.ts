import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  LocalKairosStore,
  type KairosBranch,
  type KairosEvent,
  type KairosRun,
} from "../../../src/runtime/index.js";
import {
  LocalTradingStore,
  type BrokerOrder,
  type CreateBrokerOrderInput,
  type CreateTradeIntentInput,
  type CreateTradingMessageInput,
  type PortfolioSnapshot,
  type TradeIntent,
  type TradingMessage,
  type UpdateTradeIntentInput,
} from "../../../src/trading/index.js";
import {
  kairosBranchAgentConfigSchema,
  type KairosBranchAgentConfig,
} from "../../../src/global/agent-config.js";
import type {
  AppendRunEventInput,
  BranchRecord,
  CreateBranchInput,
  CreateRunInput,
  KairosLocalStore,
  RunEventRecord,
  RunRecord,
  RouterChatRecord,
  RouterMessageRecord,
  CreateRouterChatInput,
  CreateRouterMessageInput,
  UpdateBranchInput,
} from "./store.js";

export async function createRuntimeStore(
  options: { dataDir?: string } = {},
): Promise<KairosLocalStore> {
  return new RuntimeStoreAdapter(
    new LocalKairosStore({ rootDir: options.dataDir }),
    new LocalTradingStore({
      rootDir: options.dataDir ? `${options.dataDir}/trading` : undefined,
    }),
  );
}

class RuntimeStoreAdapter implements KairosLocalStore {
  constructor(
    private readonly store: LocalKairosStore,
    private readonly tradingStore: LocalTradingStore,
  ) {}

  async listBranches(): Promise<BranchRecord[]> {
    return (await this.store.listBranches()).map(toBranchRecord);
  }

  async getBranch(id: string): Promise<BranchRecord | undefined> {
    return toOptional(await this.store.getBranch(id), toBranchRecord);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const branch = await this.store.upsertBranch({
      branchId: input.id ?? slugId(input.name),
      lawId: input.lawId,
      name: input.name,
      status: input.enabled === false ? "disabled" : "enabled",
      summary: input.description,
      assets: getAssets(input),
      payload: {
        law: input.law,
        config: input.config,
        metadata: input.metadata,
      },
    });
    return toBranchRecord(branch);
  }

  async updateBranch(
    id: string,
    input: UpdateBranchInput,
  ): Promise<BranchRecord | undefined> {
    const current = await this.store.getBranch(id);
    if (!current) {
      return undefined;
    }

    const currentPayload = readBranchPayload(current);
    const branch = await this.store.upsertBranch({
      branchId: id,
      lawId: input.lawId ?? current.lawId,
      name: input.name ?? current.name ?? id,
      status:
        input.enabled === undefined
          ? current.status
          : input.enabled
            ? "enabled"
            : "disabled",
      summary: input.description ?? current.summary,
      assets: input.config ? getAssets(input) : current.assets,
      payload: {
        law: input.law ?? currentPayload.law,
        config: input.config ?? currentPayload.config,
        metadata: input.metadata ?? currentPayload.metadata,
      },
    });
    return toBranchRecord(branch);
  }

  async deleteBranch(id: string): Promise<boolean> {
    return this.store.deleteBranch(id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return (await this.store.listRuns()).map(toRunRecord);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return toOptional(await this.store.getRun(id), toRunRecord);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const run = await this.store.createRun({
      runId: input.id,
      kind: input.kind,
      status: input.status ?? "pending",
      branchId: input.branchId,
      dryRun: input.dryRun ?? true,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
      startedAt:
        input.status === "running" ? new Date().toISOString() : undefined,
    });
    return toRunRecord(run);
  }

  async updateRun(
    id: string,
    input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>,
  ): Promise<RunRecord | undefined> {
    const run = await this.store.updateRun(id, {
      status: input.status,
      output: input.output,
      metadata: input.metadata,
      completedAt:
        input.status === "succeeded" || input.status === "failed"
          ? new Date().toISOString()
          : undefined,
    });
    return toRunRecord(run);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return (await this.store.listEvents({ runId })).map(toRunEventRecord);
  }

  async appendRunEvent(
    runId: string,
    input: AppendRunEventInput,
  ): Promise<RunEventRecord> {
    const run = await this.store.getRun(runId);
    const eventInput = {
      runId,
      scope: "run",
      type: input.type,
      actor: "local-api",
      branchId: run?.branchId,
      debateId: run?.debateId,
      payload: input.payload ?? {},
    } as const;
    const event = await this.store.appendEvent({
      ...eventInput,
      ...(input.id ? { eventId: input.id } : {}),
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    });
    return toRunEventRecord(event);
  }

  async listRouterChats(): Promise<RouterChatRecord[]> {
    return this.readRouterJsonFiles<RouterChatRecord>("chats").then((chats) =>
      sortByCreatedAt(chats),
    );
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
    await this.writeRouterJson(this.routerChatPath(chat.id), chat);
    return chat;
  }

  async getRouterChat(id: string): Promise<RouterChatRecord | undefined> {
    return toUndefined(await this.readRouterJson<RouterChatRecord>(this.routerChatPath(id)));
  }

  async listRouterMessages(chatId: string): Promise<RouterMessageRecord[]> {
    return this.readRouterJsonl<RouterMessageRecord>(this.routerMessagesPath(chatId));
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
      toolCalls: input.toolCalls,
      createdAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.routerMessagesPath(input.chatId)), { recursive: true });
    await writeFile(
      this.routerMessagesPath(input.chatId),
      `${JSON.stringify(message)}\n`,
      { flag: "a" },
    );

    const chat = await this.getRouterChat(input.chatId);
    if (chat) {
      await this.writeRouterJson(this.routerChatPath(input.chatId), {
        ...chat,
        updatedAt: message.createdAt,
      });
    }
    return message;
  }

  listMessages(): Promise<TradingMessage[]> {
    return this.tradingStore.listMessages();
  }

  createMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    return this.tradingStore.createMessage(input);
  }

  listTradeIntents(): Promise<TradeIntent[]> {
    return this.tradingStore.listTradeIntents();
  }

  getTradeIntent(id: string): Promise<TradeIntent | undefined> {
    return this.tradingStore.getTradeIntent(id);
  }

  createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    return this.tradingStore.createTradeIntent(input);
  }

  updateTradeIntent(
    id: string,
    input: UpdateTradeIntentInput,
  ): Promise<TradeIntent | undefined> {
    return this.tradingStore.updateTradeIntent(id, input);
  }

  listBrokerOrders(): Promise<BrokerOrder[]> {
    return this.tradingStore.listBrokerOrders();
  }

  createBrokerOrder(input: CreateBrokerOrderInput | BrokerOrder): Promise<BrokerOrder> {
    return this.tradingStore.createBrokerOrder(input);
  }

  listPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
    return this.tradingStore.listPortfolioSnapshots();
  }

  latestPortfolioSnapshot(): Promise<PortfolioSnapshot | undefined> {
    return this.tradingStore.latestPortfolioSnapshot();
  }

  createPortfolioSnapshot(
    input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & {
      id?: string;
      capturedAt?: string;
    },
  ): Promise<PortfolioSnapshot> {
    return this.tradingStore.createPortfolioSnapshot(input);
  }

  private get routerDir(): string {
    return join(this.store.rootDir, "router");
  }

  private routerChatPath(chatId: string): string {
    return join(this.routerDir, "chats", `${encodeFileSegment(chatId)}.json`);
  }

  private routerMessagesPath(chatId: string): string {
    return join(this.routerDir, "messages", `${encodeFileSegment(chatId)}.jsonl`);
  }

  private async writeRouterJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  }

  private async readRouterJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  private async readRouterJsonFiles<T>(subdir: string): Promise<T[]> {
    const dir = join(this.routerDir, subdir);
    let fileNames: string[];
    try {
      fileNames = await readdir(dir);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }

    return Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map(async (fileName) =>
          JSON.parse(await readFile(join(dir, fileName), "utf8")) as T,
        ),
    );
  }

  private async readRouterJsonl<T>(path: string): Promise<T[]> {
    try {
      const text = await readFile(path, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
  }
}

function toBranchRecord(branch: KairosBranch): BranchRecord {
  const payload = readBranchPayload(branch);
  return {
    id: branch.branchId,
    lawId: branch.lawId,
    name: branch.name ?? branch.branchId,
    description: branch.summary,
    enabled: branch.status === "enabled",
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    law: payload.law,
    config: payload.config,
    metadata: payload.metadata,
  };
}

function toRunRecord(run: KairosRun): RunRecord {
  return {
    id: run.runId,
    kind:
      run.kind === "debate" || run.kind === "router"
        ? run.kind
        : "heartbeat",
    status: run.status,
    branchId: run.branchId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    dryRun: run.dryRun ?? true,
    input: isJsonRecord(run.input) ? run.input : {},
    output: isJsonRecord(run.output) ? run.output : undefined,
    metadata: isJsonRecord(run.metadata) ? run.metadata : undefined,
  };
}

function toRunEventRecord(event: KairosEvent): RunEventRecord {
  return {
    id: event.eventId,
    runId: event.runId,
    type: event.type,
    timestamp: event.timestamp,
    payload: isJsonRecord(event.payload) ? event.payload : { value: event.payload },
  };
}

function toOptional<T, U>(value: T | null, map: (value: T) => U): U | undefined {
  return value === null ? undefined : map(value);
}

function toUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function readBranchPayload(branch: KairosBranch): {
  law?: Record<string, unknown>;
  config?: KairosBranchAgentConfig;
  metadata?: Record<string, unknown>;
} {
  if (!isJsonRecord(branch.payload)) {
    return {};
  }

  return {
    law: isJsonRecord(branch.payload.law) ? branch.payload.law : undefined,
    config: parseBranchAgentConfig(branch.payload.config),
    metadata: isJsonRecord(branch.payload.metadata)
      ? branch.payload.metadata
      : undefined,
  };
}

function getAssets(input: Pick<CreateBranchInput, "config">): string[] {
  const assets = input.config?.assets;
  return Array.isArray(assets)
    ? assets.filter((asset): asset is string => typeof asset === "string")
    : [];
}

function parseBranchAgentConfig(value: unknown): KairosBranchAgentConfig | undefined {
  const parsed = kairosBranchAgentConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function slugId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "branch";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isJsonRecord(error) && error.code === "ENOENT";
}

function encodeFileSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function sortByCreatedAt<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
