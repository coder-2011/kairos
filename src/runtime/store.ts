import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createKairosEvent,
  kairosBranchSchema,
  kairosEventSchema,
  kairosRunSchema,
  upsertKairosBranchInputSchema,
  updateKairosRunInputSchema,
  type CreateKairosEventInput,
  type CreateKairosRunInput,
  type KairosBranch,
  type KairosEvent,
  type KairosRun,
  type UpdateKairosRunInput,
  type UpsertKairosBranchInput,
} from "./schemas.js";
import {
  brokerOrderSchema,
  createBrokerOrderRecord,
  createTradeIntentRecord,
  createTradingMessageRecord,
  tradeIntentSchema,
  tradingMessageSchema,
  updateTradeIntentInputSchema,
  type BrokerOrder,
  type CreateBrokerOrderInput,
  type CreateTradeIntentInput,
  type CreateTradingMessageInput,
  type TradeIntent,
  type TradingMessage,
  type UpdateTradeIntentInput,
} from "../trading/schemas.js";

export type LocalKairosStoreOptions = {
  rootDir?: string;
  id?: () => string;
  now?: () => Date;
};

export type ListRunOptions = {
  branchId?: string;
  debateId?: string;
  kind?: KairosRun["kind"];
  status?: KairosRun["status"];
};

export type ListEventOptions = {
  runId?: string;
  branchId?: string;
  debateId?: string;
  scope?: KairosEvent["scope"];
  type?: string;
};

const defaultRuntimeRootDir = "data/runtime";

export class LocalKairosStore {
  readonly rootDir: string;

  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(options: LocalKairosStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultRuntimeRootDir;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async upsertBranch(input: UpsertKairosBranchInput): Promise<KairosBranch> {
    const parsed = upsertKairosBranchInputSchema.parse(input);
    const existing = await this.getBranch(parsed.branchId);
    const timestamp = this.now().toISOString();
    const branch = kairosBranchSchema.parse({
      ...existing,
      ...parsed,
      createdAt: parsed.createdAt ?? existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    await this.writeJson(this.branchPath(branch.branchId), branch);
    return branch;
  }

  async listBranches(): Promise<KairosBranch[]> {
    return this.readJsonFiles(this.branchesDir, (value) =>
      kairosBranchSchema.parse(value),
    );
  }

  async getBranch(branchId: string): Promise<KairosBranch | null> {
    const branch = await this.readJson(this.branchPath(branchId));
    return branch === null ? null : kairosBranchSchema.parse(branch);
  }

  async deleteBranch(branchId: string): Promise<boolean> {
    try {
      await unlink(this.branchPath(branchId));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async createRun(input: CreateKairosRunInput): Promise<KairosRun> {
    const timestamp = this.now().toISOString();
    const run = kairosRunSchema.parse({
      ...input,
      runId: input.runId ?? this.id(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await this.writeJson(this.runPath(run.runId), run);
    return run;
  }

  async getRun(runId: string): Promise<KairosRun | null> {
    const run = await this.readJson(this.runPath(runId));
    return run === null ? null : kairosRunSchema.parse(run);
  }

  async listRuns(options: ListRunOptions = {}): Promise<KairosRun[]> {
    const runs = await this.readJsonFiles(this.runsDir, (value) =>
      kairosRunSchema.parse(value),
    );
    return runs.filter((run) => {
      return (
        matches(options.branchId, run.branchId) &&
        matches(options.debateId, run.debateId) &&
        matches(options.kind, run.kind) &&
        matches(options.status, run.status)
      );
    });
  }

  async updateRun(
    runId: string,
    input: UpdateKairosRunInput,
  ): Promise<KairosRun> {
    const existing = await this.getRun(runId);
    if (existing === null) {
      throw new Error(`Run not found: ${runId}`);
    }

    const patch = updateKairosRunInputSchema.parse(input);
    const run = kairosRunSchema.parse({
      ...existing,
      ...patch,
      runId: existing.runId,
      kind: existing.kind,
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
    });

    await this.writeJson(this.runPath(runId), run);
    return run;
  }

  async appendEvent(
    input: CreateKairosEventInput | KairosEvent,
  ): Promise<KairosEvent> {
    const event =
      "eventId" in input && "timestamp" in input
        ? kairosEventSchema.parse(input)
        : createKairosEvent(input, { id: this.id, now: this.now });

    await mkdir(this.eventsDir, { recursive: true });
    await writeFile(
      this.eventsPath(event.runId),
      `${JSON.stringify(event)}\n`,
      { flag: "a" },
    );
    return event;
  }

  async listEvents(options: ListEventOptions = {}): Promise<KairosEvent[]> {
    const events = options.runId
      ? await this.readRunEvents(options.runId)
      : await this.readAllEvents();

    return events.filter((event) => {
      return (
        matches(options.branchId, event.branchId) &&
        matches(options.debateId, event.debateId) &&
        matches(options.scope, event.scope) &&
        matches(options.type, event.type)
      );
    });
  }

  async createTradingMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    const message = createTradingMessageRecord(input, {
      id: this.id,
      now: this.now,
    });
    await this.writeJson(this.tradingMessagePath(message.id), message);
    return message;
  }

  async listTradingMessages(): Promise<TradingMessage[]> {
    return this.readJsonFiles(this.tradingMessagesDir, (value) =>
      tradingMessageSchema.parse(value),
    );
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    const intent = createTradeIntentRecord(input, {
      id: this.id,
      now: this.now,
    });
    await this.writeJson(this.tradeIntentPath(intent.id), intent);
    return intent;
  }

  async updateTradeIntent(
    intentId: string,
    input: UpdateTradeIntentInput,
  ): Promise<TradeIntent> {
    const existing = await this.getTradeIntent(intentId);
    if (existing === null) {
      throw new Error(`Trade intent not found: ${intentId}`);
    }
    const patch = updateTradeIntentInputSchema.parse(input);
    const intent = tradeIntentSchema.parse({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
    });
    await this.writeJson(this.tradeIntentPath(intent.id), intent);
    return intent;
  }

  async getTradeIntent(intentId: string): Promise<TradeIntent | null> {
    const intent = await this.readJson(this.tradeIntentPath(intentId));
    return intent === null ? null : tradeIntentSchema.parse(intent);
  }

  async listTradeIntents(): Promise<TradeIntent[]> {
    return this.readJsonFiles(this.tradeIntentsDir, (value) =>
      tradeIntentSchema.parse(value),
    );
  }

  async createBrokerOrder(input: CreateBrokerOrderInput): Promise<BrokerOrder> {
    const order = createBrokerOrderRecord(input, {
      id: this.id,
      now: this.now,
    });
    await this.writeJson(this.brokerOrderPath(order.id), order);
    return order;
  }

  async listBrokerOrders(): Promise<BrokerOrder[]> {
    return this.readJsonFiles(this.brokerOrdersDir, (value) =>
      brokerOrderSchema.parse(value),
    );
  }

  private get branchesDir(): string {
    return join(this.rootDir, "branches");
  }

  private get runsDir(): string {
    return join(this.rootDir, "runs");
  }

  private get eventsDir(): string {
    return join(this.rootDir, "events");
  }

  private get tradingMessagesDir(): string {
    return join(this.rootDir, "trading", "messages");
  }

  private get tradeIntentsDir(): string {
    return join(this.rootDir, "trading", "trade-intents");
  }

  private get brokerOrdersDir(): string {
    return join(this.rootDir, "trading", "broker-orders");
  }

  private branchPath(branchId: string): string {
    return join(this.branchesDir, `${encodeFileSegment(branchId)}.json`);
  }

  private runPath(runId: string): string {
    return join(this.runsDir, `${encodeFileSegment(runId)}.json`);
  }

  private eventsPath(runId: string): string {
    return join(this.eventsDir, `${encodeFileSegment(runId)}.jsonl`);
  }

  private tradingMessagePath(messageId: string): string {
    return join(this.tradingMessagesDir, `${encodeFileSegment(messageId)}.json`);
  }

  private tradeIntentPath(intentId: string): string {
    return join(this.tradeIntentsDir, `${encodeFileSegment(intentId)}.json`);
  }

  private brokerOrderPath(orderId: string): string {
    return join(this.brokerOrdersDir, `${encodeFileSegment(orderId)}.json`);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.${this.id()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  }

  private async readJson(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readJsonFiles<T>(
    dir: string,
    parse: (value: unknown) => T,
  ): Promise<T[]> {
    let fileNames: string[];
    try {
      fileNames = await readdir(dir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    const records = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map(async (fileName) =>
          parse(JSON.parse(await readFile(join(dir, fileName), "utf8"))),
        ),
    );

    return records;
  }

  private async readAllEvents(): Promise<KairosEvent[]> {
    let fileNames: string[];
    try {
      fileNames = await readdir(this.eventsDir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    const eventGroups = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".jsonl"))
        .sort()
        .map((fileName) =>
          this.readEventsFile(join(this.eventsDir, fileName)),
        ),
    );

    return eventGroups.flat();
  }

  private async readRunEvents(runId: string): Promise<KairosEvent[]> {
    try {
      return await this.readEventsFile(this.eventsPath(runId));
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async readEventsFile(path: string): Promise<KairosEvent[]> {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => kairosEventSchema.parse(JSON.parse(line)));
  }
}

function encodeFileSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function matches<T>(expected: T | undefined, actual: T | undefined): boolean {
  return expected === undefined || actual === expected;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
