import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  brokerOrderSchema,
  createBrokerOrderRecord,
  createPortfolioSnapshotRecord,
  createTradeIntentRecord,
  createTradingMessageRecord,
  portfolioSnapshotSchema,
  tradeIntentSchema,
  tradingMessageSchema,
  updateTradeIntentInputSchema,
  type BrokerOrder,
  type CreateBrokerOrderInput,
  type CreateTradeIntentInput,
  type CreateTradingMessageInput,
  type PortfolioSnapshot,
  type TradeIntent,
  type UpdateTradeIntentInput,
  type TradingMessage,
} from "./schemas.js";

export type LocalTradingStoreOptions = {
  rootDir?: string;
  id?: () => string;
  now?: () => Date;
};

const defaultTradingRootDir = "data/runtime/trading";

export class LocalTradingStore {
  readonly rootDir: string;

  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(options: LocalTradingStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultTradingRootDir;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async listMessages(): Promise<TradingMessage[]> {
    return this.readJsonFiles(this.messagesDir, tradingMessageSchema.parse).then(sortCreated);
  }

  async createMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    const message = createTradingMessageRecord(input, { id: this.id, now: this.now });
    await this.writeJson(this.messagePath(message.id), message);
    return message;
  }

  async listTradeIntents(): Promise<TradeIntent[]> {
    return this.readJsonFiles(this.tradeIntentsDir, tradeIntentSchema.parse).then(sortCreated);
  }

  async getTradeIntent(id: string): Promise<TradeIntent | undefined> {
    const intent = await this.readJson(this.tradeIntentPath(id));
    return intent === null ? undefined : tradeIntentSchema.parse(intent);
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    const intent = createTradeIntentRecord(input, { id: this.id, now: this.now });
    await this.writeJson(this.tradeIntentPath(intent.id), intent);
    return intent;
  }

  async updateTradeIntent(
    id: string,
    input: UpdateTradeIntentInput,
  ): Promise<TradeIntent | undefined> {
    const current = await this.getTradeIntent(id);
    if (!current) return undefined;

    const patch = updateTradeIntentInputSchema.parse(input);
    const updated = tradeIntentSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
    });
    await this.writeJson(this.tradeIntentPath(id), updated);
    return updated;
  }

  async listBrokerOrders(): Promise<BrokerOrder[]> {
    return this.readJsonFiles(this.brokerOrdersDir, brokerOrderSchema.parse).then(sortCreated);
  }

  async createBrokerOrder(input: CreateBrokerOrderInput | BrokerOrder): Promise<BrokerOrder> {
    const order = "id" in input && "createdAt" in input
      ? brokerOrderSchema.parse(input)
      : createBrokerOrderRecord(input, { id: this.id, now: this.now });
    await this.writeJson(this.brokerOrderPath(order.id), order);
    return order;
  }

  async listPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
    return this.readJsonFiles(this.portfolioSnapshotsDir, portfolioSnapshotSchema.parse).then(sortCaptured);
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
    const snapshot = createPortfolioSnapshotRecord(input, { id: this.id, now: this.now });
    await this.writeJson(this.portfolioSnapshotPath(snapshot.id), snapshot);
    return snapshot;
  }

  private get messagesDir(): string {
    return join(this.rootDir, "messages");
  }

  private get tradeIntentsDir(): string {
    return join(this.rootDir, "trade-intents");
  }

  private get brokerOrdersDir(): string {
    return join(this.rootDir, "broker-orders");
  }

  private get portfolioSnapshotsDir(): string {
    return join(this.rootDir, "portfolio-snapshots");
  }

  private messagePath(id: string): string {
    return join(this.messagesDir, `${encodeFileSegment(id)}.json`);
  }

  private tradeIntentPath(id: string): string {
    return join(this.tradeIntentsDir, `${encodeFileSegment(id)}.json`);
  }

  private brokerOrderPath(id: string): string {
    return join(this.brokerOrdersDir, `${encodeFileSegment(id)}.json`);
  }

  private portfolioSnapshotPath(id: string): string {
    return join(this.portfolioSnapshotsDir, `${encodeFileSegment(id)}.json`);
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
      if (isNotFoundError(error)) return null;
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
      if (isNotFoundError(error)) return [];
      throw error;
    }

    return Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map(async (fileName) =>
          parse(JSON.parse(await readFile(join(dir, fileName), "utf8"))),
        ),
    );
  }
}

function sortCreated<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function sortCaptured<T extends { capturedAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

function encodeFileSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
