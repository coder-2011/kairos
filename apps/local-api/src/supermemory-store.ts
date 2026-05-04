import {
  getMemoryContainerTag,
  type SupermemoryMirror,
} from "../../../src/global/index.js";
import type {
  BrokerOrder,
  CreateBrokerOrderInput,
  CreateTradeIntentInput,
  CreateTradingMessageInput,
  PortfolioSnapshot,
  TradeIntent,
  TradingMessage,
  UpdateTradeIntentInput,
} from "../../../src/trading/index.js";
import type {
  AppendRunEventInput,
  BranchRecord,
  CreateBranchInput,
  CreateDeepResearchChatInput,
  CreateDeepResearchMessageInput,
  CreateRunInput,
  CreateRouterChatInput,
  CreateRouterMessageInput,
  DeepResearchChatRecord,
  DeepResearchMessageRecord,
  KairosLocalStore,
  RouterChatRecord,
  RouterMessageRecord,
  RunEventRecord,
  RunEventSubscriber,
  RunRecord,
  UpdateBranchInput,
} from "./store.js";

export function createSupermemoryMirroredStore(
  store: KairosLocalStore,
  mirror: SupermemoryMirror | undefined,
  options: { required?: boolean } = {},
): KairosLocalStore {
  if (!mirror) {
    return store;
  }

  return new SupermemoryMirroredStore(store, mirror, options);
}

class SupermemoryMirroredStore implements KairosLocalStore {
  constructor(
    private readonly store: KairosLocalStore,
    private readonly mirror: SupermemoryMirror,
    private readonly options: { required?: boolean } = {},
  ) {}

  listBranches(): Promise<BranchRecord[]> {
    return this.store.listBranches();
  }

  getBranch(id: string): Promise<BranchRecord | undefined> {
    return this.store.getBranch(id);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const branch = await this.store.createBranch(input);
    await this.mirrorBranch("branch.created", branch);
    return branch;
  }

  async updateBranch(
    id: string,
    input: UpdateBranchInput,
  ): Promise<BranchRecord | undefined> {
    const branch = await this.store.updateBranch(id, input);
    if (branch) {
      await this.mirrorBranch("branch.updated", branch);
    }
    return branch;
  }

  async deleteBranch(id: string): Promise<boolean> {
    const branch = await this.store.getBranch(id);
    const deleted = await this.store.deleteBranch(id);
    if (deleted) {
      await this.mirrorRecord({
        type: "branch.deleted",
        scope: "branch",
        branchId: id,
        lawId: branch?.lawId,
        timestamp: new Date().toISOString(),
        title: `Kairos branch deleted: ${branch?.name ?? id}`,
        summary: `Deleted branch ${branch?.name ?? id}.`,
        data: branch ?? { id },
        customId: `kairos:branch:${id}:deleted`,
      });
    }
    return deleted;
  }

  listRuns(): Promise<RunRecord[]> {
    return this.store.listRuns();
  }

  getRun(id: string): Promise<RunRecord | undefined> {
    return this.store.getRun(id);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const run = await this.store.createRun(input);
    await this.mirrorRun("run.created", run);
    return run;
  }

  async updateRun(
    id: string,
    input: Partial<Pick<RunRecord, "status" | "output" | "metadata" | "lifecycle">>,
  ): Promise<RunRecord | undefined> {
    const run = await this.store.updateRun(id, input);
    if (run) {
      await this.mirrorRun("run.updated", run);
      if (run.kind === "debate" && run.output) {
        await this.mirrorRecord({
          type: "debate.output",
          scope: "debate",
          runId: run.id,
          branchId: run.branchId,
          timestamp: run.updatedAt,
          title: `Kairos debate output ${run.id}`,
          summary: readSummary(run.output),
        data: {
          run,
          output: run.output,
        },
          customId: `kairos:run:${run.id}:debate_output:${run.updatedAt}`,
        });
      }
    }
    return run;
  }

  listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return this.store.listRunEvents(runId);
  }

  async appendRunEvent(
    runId: string,
    input: AppendRunEventInput,
  ): Promise<RunEventRecord> {
    const event = await this.store.appendRunEvent(runId, input);
    const run = await this.store.getRun(runId);
    await this.mirrorRecord({
      type: event.type,
      scope: "run_event",
      runId: event.runId,
      branchId: run?.branchId,
      timestamp: event.timestamp,
      actor: "local-api",
      title: `Kairos event ${event.type}`,
      summary: readSummary(event.payload) ?? event.type,
      data: {
        run,
        event,
      },
      customId: `kairos:run:${event.runId}:event:${event.id}`,
    });
    return event;
  }

  subscribeToRunEvents(
    runId: string,
    subscriber: RunEventSubscriber,
  ): () => void {
    return this.store.subscribeToRunEvents?.(runId, subscriber) ?? (() => {});
  }

  listRouterChats(): Promise<RouterChatRecord[]> {
    return this.store.listRouterChats();
  }

  async createRouterChat(
    input?: CreateRouterChatInput,
  ): Promise<RouterChatRecord> {
    const chat = await this.store.createRouterChat(input);
    await this.mirrorRecord({
      type: "router_chat.created",
      scope: "router",
      timestamp: chat.createdAt,
      artifactId: chat.id,
      title: chat.title ?? `Kairos router chat ${chat.id}`,
      summary: "Router chat created.",
      data: chat,
      customId: `kairos:router_chat:${chat.id}`,
    });
    return chat;
  }

  async deleteRouterChat(id: string): Promise<boolean> {
    const chat = await this.store.getRouterChat(id);
    const deleted = await this.store.deleteRouterChat(id);
    if (deleted) {
      await this.mirrorRecord({
        type: "router_chat.deleted",
        scope: "router",
        timestamp: new Date().toISOString(),
        artifactId: id,
        title: chat?.title ?? `Kairos router chat ${id}`,
        summary: `Deleted router chat ${chat?.title ?? id}.`,
        data: chat ?? { id },
        customId: `kairos:router_chat:${id}:deleted`,
      });
    }
    return deleted;
  }

  getRouterChat(id: string): Promise<RouterChatRecord | undefined> {
    return this.store.getRouterChat(id);
  }

  listRouterMessages(chatId: string): Promise<RouterMessageRecord[]> {
    return this.store.listRouterMessages(chatId);
  }

  async createRouterMessage(
    input: CreateRouterMessageInput,
  ): Promise<RouterMessageRecord> {
    const message = await this.store.createRouterMessage(input);
    await this.mirrorRecord({
      type: `router_message.${message.role}`,
      scope: "router",
      runId: message.runId,
      timestamp: message.createdAt,
      artifactId: message.id,
      actor: message.role === "user" ? "human" : "router",
      title: `Kairos router ${message.role} message`,
      summary:
        message.text ??
        `Router message with ${message.attachments?.length ?? 0} attachment(s).`,
      data: message,
      metadata: {
        chat_id: message.chatId,
        attachment_count: message.attachments?.length ?? 0,
      },
      customId: `kairos:router_message:${message.id}`,
    });
    return message;
  }

  listDeepResearchChats(): Promise<DeepResearchChatRecord[]> {
    return this.store.listDeepResearchChats();
  }

  createDeepResearchChat(
    input?: CreateDeepResearchChatInput,
  ): Promise<DeepResearchChatRecord> {
    return this.store.createDeepResearchChat(input);
  }

  getDeepResearchChat(id: string): Promise<DeepResearchChatRecord | undefined> {
    return this.store.getDeepResearchChat(id);
  }

  deleteDeepResearchChat(id: string): Promise<boolean> {
    return this.store.deleteDeepResearchChat(id);
  }

  listDeepResearchMessages(chatId: string): Promise<DeepResearchMessageRecord[]> {
    return this.store.listDeepResearchMessages(chatId);
  }

  createDeepResearchMessage(
    input: CreateDeepResearchMessageInput,
  ): Promise<DeepResearchMessageRecord> {
    return this.store.createDeepResearchMessage(input);
  }

  listMessages(): Promise<TradingMessage[]> {
    return this.store.listMessages();
  }

  async createMessage(input: CreateTradingMessageInput): Promise<TradingMessage> {
    const message = await this.store.createMessage(input);
    await this.mirrorRecord({
      type: `trading_message.${message.type}`,
      scope: "notification",
      runId: message.sourceRunId,
      branchId: message.branchId,
      lawId: message.lawId,
      timestamp: message.createdAt,
      title: message.title,
      summary: message.body,
      data: message,
      customId: `kairos:message:${message.id}`,
    });
    return message;
  }

  listTradeIntents(): Promise<TradeIntent[]> {
    return this.store.listTradeIntents();
  }

  getTradeIntent(id: string): Promise<TradeIntent | undefined> {
    return this.store.getTradeIntent(id);
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<TradeIntent> {
    const intent = await this.store.createTradeIntent(input);
    await this.mirrorTradeIntent("trade_intent.created", intent);
    return intent;
  }

  async updateTradeIntent(
    id: string,
    input: UpdateTradeIntentInput,
  ): Promise<TradeIntent | undefined> {
    const intent = await this.store.updateTradeIntent(id, input);
    if (intent) {
      await this.mirrorTradeIntent("trade_intent.updated", intent);
    }
    return intent;
  }

  listBrokerOrders(): Promise<BrokerOrder[]> {
    return this.store.listBrokerOrders();
  }

  async createBrokerOrder(
    input: CreateBrokerOrderInput | BrokerOrder,
  ): Promise<BrokerOrder> {
    const order = await this.store.createBrokerOrder(input);
    await this.mirrorRecord({
      type: "broker_order.created",
      scope: "broker_order",
      artifactId: order.id,
      timestamp: order.createdAt,
      title: `Kairos broker order ${order.symbol}`,
      summary: `${order.side} ${order.symbol} ${order.status}`,
      data: order,
      customId: `kairos:broker_order:${order.id}`,
    });
    return order;
  }

  listPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
    return this.store.listPortfolioSnapshots();
  }

  latestPortfolioSnapshot(): Promise<PortfolioSnapshot | undefined> {
    return this.store.latestPortfolioSnapshot();
  }

  async createPortfolioSnapshot(
    input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & {
      id?: string;
      capturedAt?: string;
    },
  ): Promise<PortfolioSnapshot> {
    const snapshot = await this.store.createPortfolioSnapshot(input);
    await this.mirrorRecord({
      type: "portfolio_snapshot.created",
      scope: "portfolio",
      artifactId: snapshot.id,
      timestamp: snapshot.capturedAt,
      title: "Kairos portfolio snapshot",
      summary: `Portfolio snapshot with ${snapshot.positions.length} positions.`,
      data: snapshot,
      customId: `kairos:portfolio_snapshot:${snapshot.id}`,
    });
    return snapshot;
  }

  private mirrorBranch(type: string, branch: BranchRecord): Promise<void> {
    return this.mirrorRecord({
      type,
      scope: "branch",
      branchId: branch.id,
      lawId: branch.lawId,
      timestamp: branch.updatedAt,
      title: `Kairos branch ${branch.name}`,
      summary: branch.description ?? readSummary(branch.law) ?? branch.name,
      data: branch,
      containerTags: branchSupermemoryContainerTags(branch),
      customId: `kairos:branch:${branch.id}:${branch.updatedAt}`,
    });
  }

  private async mirrorRun(type: string, run: RunRecord): Promise<void> {
    const branch = run.branchId ? await this.store.getBranch(run.branchId) : undefined;
    return this.mirrorRecord({
      type,
      scope: run.kind,
      runId: run.id,
      branchId: run.branchId,
      timestamp: run.updatedAt,
      title: `Kairos ${run.kind} run ${run.id}`,
      summary: readSummary(run.output) ?? `${run.kind} run is ${run.status}.`,
      data: run,
      metadata: {
        run_kind: run.kind,
        run_status: run.status,
      },
      containerTags: branch ? branchSupermemoryContainerTags(branch) : undefined,
      customId: `kairos:run:${run.id}:${type}:${run.updatedAt}`,
    });
  }

  private mirrorTradeIntent(type: string, intent: TradeIntent): Promise<void> {
    return this.mirrorRecord({
      type,
      scope: "trade_intent",
      runId: intent.sourceRunId,
      branchId: intent.branchId,
      lawId: intent.lawId,
      artifactId: intent.id,
      timestamp: intent.updatedAt,
      title: `Kairos trade intent ${intent.symbol}`,
      summary: `${intent.side} ${intent.symbol}: ${intent.reasoning}`,
      data: intent,
      metadata: {
        symbol: intent.symbol,
        side: intent.side,
        confidence: intent.confidence,
        status: intent.status,
        mode: intent.mode,
      },
      customId: `kairos:trade_intent:${intent.id}:${type}:${intent.updatedAt}`,
    });
  }

  private async mirrorRecord(
    record: Parameters<SupermemoryMirror["mirrorRecord"]>[0],
  ): Promise<void> {
    const mirror = this.mirror.mirrorRecord(record).catch((error: unknown) => {
      if (this.options.required) {
        throw error;
      }
      // Local files remain the audit log; Supermemory is the agent memory
      // backbone. Preserve the local write if external memory is temporarily
      // down unless strict mirroring is explicitly required.
    });

    if (this.options.required) {
      await mirror;
      return;
    }

    void mirror;
  }
}

function readSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["summary", "body", "reasoning", "message", "decision"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function branchSupermemoryContainerTags(branch: BranchRecord): string[] {
  return [
    getMemoryContainerTag({
      configuredContainerTag: branch.config?.memory?.supermemoryContainerTag,
      scopeId: branch.id,
      prefix: "branch",
    }),
    getMemoryContainerTag({
      configuredContainerTag: branch.config?.memory?.supermemoryProfileContainerTag,
      scopeId: branch.id,
      prefix: "branch_profile",
    }),
  ];
}
