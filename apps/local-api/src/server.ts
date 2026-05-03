import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  kairosBranchAgentConfigSchema,
  listOpenRouterModels,
} from "../../../src/global/index.js";
import {
  createAlpacaPaperBroker,
  createTradeIntentInputSchema,
  evaluateTradingThresholdPolicy,
  submitPaperOrder,
  tradingConfigSchema,
  type PaperTradingBroker,
  type TradeIntent,
  type TradingConfig,
} from "../../../src/trading/index.js";
import { createRuntimeStore } from "./runtime.js";
import {
  MemoryKairosStore,
  type AppendRunEventInput,
  type BranchRecord,
  type KairosLocalStore,
  type JsonRecord,
  type RunRecord,
} from "./store.js";

export type LocalApiDependencies = {
  store?: KairosLocalStore;
  runHeartbeat?: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate?: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  tradingBroker?: PaperTradingBroker;
};

export type LocalApiOptions = {
  dependencies?: LocalApiDependencies;
  dataDir?: string;
};

export type LocalApiContext = {
  store: KairosLocalStore;
  runHeartbeat: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  tradingBroker?: PaperTradingBroker;
};

type HeartbeatTriggerInput = {
  branchId: string;
  dryRun: boolean;
  payload: JsonRecord;
  branch: BranchRecord;
};

type HeartbeatRunResult = {
  output: JsonRecord;
  events?: AppendRunEventInput[];
};

type DebateCreateInput = {
  dryRun: boolean;
  payload: JsonRecord;
  branch?: BranchRecord;
};

type DebateCreateResult = {
  output: JsonRecord;
  events?: AppendRunEventInput[];
};

const branchCreateSchema = z.object({
  id: z.string().min(1).optional(),
  lawId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  law: z.record(z.string(), z.unknown()).optional(),
  config: kairosBranchAgentConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const branchUpdateSchema = branchCreateSchema.omit({ id: true }).partial();

const heartbeatTriggerSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const debateCreateSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  escalation: z.record(z.string(), z.unknown()).optional(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const interjectionSchema = z.object({
  author: z.string().min(1).optional().default("human"),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const paperSubmitSchema = z.object({
  tradingConfig: tradingConfigSchema.optional(),
});

export async function createLocalApiContext(options: LocalApiOptions = {}): Promise<LocalApiContext> {
  const store = options.dependencies?.store ?? await createRuntimeStore({ dataDir: options.dataDir });
  return {
    store,
    runHeartbeat: options.dependencies?.runHeartbeat ?? deterministicHeartbeat,
    createDebate: options.dependencies?.createDebate ?? deterministicDebate,
    tradingBroker: options.dependencies?.tradingBroker ?? lazyAlpacaPaperBroker(),
  };
}

export function createLocalApiHandler(context: LocalApiContext): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);

    try {
      if (request.method === "OPTIONS") return empty(204);
      if (!route) return json({ error: "not_found", message: "Route not found." }, 404);

      switch (route.name) {
        case "health":
          return json({ ok: true, service: "kairos-local-api", mode: "local" });

        case "listOpenRouterModels":
          return json({ models: await listOpenRouterModels({ requireTools: true }) });

        case "listBranches":
          return json({ branches: await context.store.listBranches() });

        case "createBranch":
          return json({ branch: await context.store.createBranch(branchCreateSchema.parse(await readJson(request))) }, 201);

        case "getBranch": {
          const branch = await context.store.getBranch(route.params.branchId);
          return branch ? json({ branch }) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "updateBranch": {
          const branch = await context.store.updateBranch(route.params.branchId, branchUpdateSchema.parse(await readJson(request)));
          return branch ? json({ branch }) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "deleteBranch": {
          const deleted = await context.store.deleteBranch(route.params.branchId);
          return deleted ? empty(204) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "listRuns":
          return json({ runs: await context.store.listRuns() });

        case "getRun": {
          const run = await context.store.getRun(route.params.runId);
          return run ? json({ run }) : json({ error: "not_found", message: "Run not found." }, 404);
        }

        case "listRunEvents": {
          const run = await context.store.getRun(route.params.runId);
          if (!run) return json({ error: "not_found", message: "Run not found." }, 404);
          return json({ events: await context.store.listRunEvents(route.params.runId) });
        }

        case "triggerHeartbeat":
          return triggerHeartbeat(context, route.params.branchId, await readJson(request));

        case "createDebate":
          return createDebate(context, await readJson(request));

        case "appendInterjection":
          return appendInterjection(context, route.params.runId, await readJson(request));

        case "streamRunEvents":
          return streamRunEvents(context, route.params.runId);

        case "getPortfolio":
          return getPortfolio(context, url.searchParams);

        case "refreshPortfolio":
          return refreshPortfolio(context);

        case "listMessages":
          return json({ messages: await context.store.listMessages() });

        case "listTradeIntents":
          return json({ tradeIntents: await context.store.listTradeIntents() });

        case "createTradeIntent":
          return createTradeIntent(context, await readJson(request));

        case "submitPaperTradeIntent":
          return submitPaperTradeIntent(
            context,
            route.params.tradeIntentId,
            paperSubmitSchema.parse(await readJson(request)).tradingConfig,
          );

        case "listBrokerOrders":
          return json({ brokerOrders: await context.store.listBrokerOrders() });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ error: "bad_request", issues: error.issues }, 400);
      }
      return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unknown error." }, 500);
    }
  };
}

export async function createLocalApi(options: LocalApiOptions = {}): Promise<{ context: LocalApiContext; handler: (request: Request) => Promise<Response> }> {
  const context = await createLocalApiContext(options);
  return { context, handler: createLocalApiHandler(context) };
}

export async function serveLocalApi(options: LocalApiOptions & { port?: number; hostname?: string } = {}) {
  const { handler } = await createLocalApi(options);
  const port = options.port ?? Number(process.env.KAIROS_LOCAL_API_PORT ?? 4321);
  const hostname = options.hostname ?? process.env.KAIROS_LOCAL_API_HOST ?? "127.0.0.1";

  if ("Bun" in globalThis) {
    const bun = (globalThis as typeof globalThis & { Bun: { serve: (options: { port: number; hostname: string; fetch: (request: Request) => Promise<Response> }) => unknown } }).Bun;
    return bun.serve({ port, hostname, fetch: handler });
  }

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request) as ReadableStream;
    const apiResponse = await handler(new Request(`http://${request.headers.host ?? `${hostname}:${port}`}${request.url ?? "/"}`, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers));
    if (apiResponse.body) {
      for await (const chunk of apiResponse.body) {
        response.write(chunk);
      }
    }
    response.end();
  });

  server.listen(port, hostname);
  return server;
}

async function triggerHeartbeat(context: LocalApiContext, branchId: string, body: unknown): Promise<Response> {
  const branch = await context.store.getBranch(branchId);
  if (!branch) return json({ error: "not_found", message: "Branch not found." }, 404);

  const input = heartbeatTriggerSchema.parse(body);
  const runPayload = {
    ...input.input,
    branch: branchRunContext(branch),
  };
  const run = await context.store.createRun({
    kind: "heartbeat",
    status: "running",
    branchId,
    dryRun: input.dryRun,
    input: runPayload,
    metadata: { source: input.dryRun ? "dry_run" : "runtime" },
  });
  await context.store.appendRunEvent(run.id, { type: "run.started", payload: { kind: "heartbeat", branchId, dryRun: input.dryRun } });

  let result: HeartbeatRunResult;
  try {
    result = await context.runHeartbeat({
      branchId,
      dryRun: input.dryRun,
      payload: runPayload,
      branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: message },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: message },
    });
    return json({ run: failed, error: "run_failed", message }, 500);
  }
  for (const event of result.events ?? []) {
    await context.store.appendRunEvent(run.id, event);
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  if (completed) {
    await applyTradingPolicyToDebate(context, completed, branch);
  }
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return json({ run: completed }, 201);
}

async function applyTradingPolicyToDebate(
  context: LocalApiContext,
  run: RunRecord,
  branch: BranchRecord | undefined,
): Promise<void> {
  const decision = extractTradingDecision(run.output);
  if (!decision) return;

  const branchConfig = branch?.config;
  const tradingConfig = tradingConfigSchema.parse(branchConfig?.trading ?? {});
  const policy = evaluateTradingThresholdPolicy({
    confidence: decision.confidence,
    branchConfig,
    tradingConfig,
  });

  await context.store.appendRunEvent(run.id, {
    type: "trading.threshold.evaluated",
    payload: policy,
  });

  if (policy.permittedAction === "record_only") {
    return;
  }

  const messageType =
    policy.permittedAction === "message_human"
      ? "threshold_notify"
      : "paper_trade_candidate";
  let intent: TradeIntent | undefined;

  if (
    policy.permittedAction === "paper_buy_intent" ||
    policy.permittedAction === "paper_order"
  ) {
    const symbol = firstConfiguredSymbol(branch);
    if (!symbol) {
      await context.store.createMessage({
        type: "paper_order_blocked",
        severity: "warning",
        title: "Paper trade blocked",
        body: "The debate crossed the paper trade threshold, but this branch has no configured asset symbol.",
        branchId: branch?.id,
        lawId: branch?.lawId,
        sourceRunId: run.id,
        confidence: decision.confidence,
      });
      return;
    }

    intent = await context.store.createTradeIntent({
      branchId: branch?.id,
      lawId: branch?.lawId,
      sourceRunId: run.id,
      symbol,
      side: "buy",
      qty: undefined,
      notional:
        tradingConfig.maxNotionalPerOrder ??
        tradingConfig.maxNotionalUsd ??
        500,
      orderType:
        tradingConfig.allowedOrderType === "limit" ||
        tradingConfig.defaultOrderType === "limit"
          ? "limit"
          : "market",
      timeInForce: tradingConfig.defaultTimeInForce ?? "day",
      confidence: decision.confidence,
      evidence: decision.citations,
      reasoning: decision.summary,
      expectedCatalyst: decision.summary,
      risk: "Generated from a debate threshold crossing; review source quality, volatility, and position exposure.",
      timeHorizon: "Branch-defined event horizon.",
      positionSizingRationale: `Uses configured max paper notional ${
        tradingConfig.maxNotionalPerOrder ?? tradingConfig.maxNotionalUsd ?? 500
      }.`,
      invalidationCondition: "Evidence is stale, contradicted, immaterial, or already priced in.",
      exitCondition: "Manual review or future branch-specific exit law.",
      approvalsRequired:
        policy.permittedAction === "paper_order" ? [] : ["paper_auto_buy_disabled"],
      status: policy.permittedAction === "paper_order" ? "paper_ready" : "draft",
      tradingConfig,
      metadata: {
        thresholdPolicy: policy,
        autoBuyEnabled: policy.paperAutoBuyEnabled,
      },
    });

    await context.store.appendRunEvent(run.id, {
      type: "trading.intent.created",
      payload: { tradeIntentId: intent.id, permittedAction: policy.permittedAction },
    });
  }

  await context.store.createMessage({
    type: messageType,
    severity: policy.permittedAction === "message_human" ? "info" : "action",
    title:
      policy.permittedAction === "message_human"
        ? "Signal crossed notification threshold"
        : "Signal crossed paper trade threshold",
    body: decision.summary,
    branchId: branch?.id,
    lawId: branch?.lawId,
    sourceRunId: run.id,
    tradeIntentId: intent?.id,
    confidence: decision.confidence,
    metadata: {
      thresholdPolicy: policy,
      citations: decision.citations,
    },
  });

  if (policy.permittedAction !== "paper_order" || !intent) {
    return;
  }

  await submitPaperTradeIntent(context, intent.id, tradingConfig);
}

async function createDebate(context: LocalApiContext, body: unknown): Promise<Response> {
  const input = debateCreateSchema.parse(body);
  const payload: JsonRecord = { ...input.input, escalation: input.escalation ?? input.input.escalation };
  const escalation = isJsonRecord(payload.escalation) ? payload.escalation : undefined;
  const branchId =
    typeof payload.branchId === "string"
      ? payload.branchId
      : typeof escalation?.branchId === "string"
        ? escalation.branchId
        : undefined;
  const branch = branchId ? await context.store.getBranch(branchId) : undefined;
  const runPayload = branch
    ? { ...payload, branch: branchRunContext(branch) }
    : payload;
  const run = await context.store.createRun({
    kind: "debate",
    status: "running",
    branchId,
    dryRun: input.dryRun,
    input: runPayload,
    metadata: { source: input.dryRun ? "dry_run" : "runtime" },
  });
  await context.store.appendRunEvent(run.id, { type: "run.started", payload: { kind: "debate", dryRun: input.dryRun } });

  let result: DebateCreateResult;
  try {
    result = await context.createDebate({
      dryRun: input.dryRun,
      payload: runPayload,
      branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: message },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: message },
    });
    return json({ run: failed, error: "run_failed", message }, 500);
  }
  for (const event of result.events ?? []) {
    await context.store.appendRunEvent(run.id, event);
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  if (completed) {
    await applyTradingPolicyToDebate(context, completed, branch);
  }
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return json({ run: completed }, 201);
}

async function appendInterjection(context: LocalApiContext, runId: string, body: unknown): Promise<Response> {
  const run = await context.store.getRun(runId);
  if (!run) return json({ error: "not_found", message: "Run not found." }, 404);

  const input = interjectionSchema.parse(body);
  const event = await context.store.appendRunEvent(runId, {
    type: "human.interjection",
    payload: {
      author: input.author,
      message: input.message,
      metadata: input.metadata,
    },
  });
  return json({ event }, 201);
}

async function getPortfolio(
  context: LocalApiContext,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (searchParams.get("refresh") === "true") {
    return refreshPortfolio(context);
  }

  const latestSnapshot = await context.store.latestPortfolioSnapshot();
  const portfolioError = latestSnapshot ? undefined : "No cached Alpaca portfolio snapshot.";

  const [snapshots, brokerOrders, tradeIntents, messages] =
    await Promise.all([
      context.store.listPortfolioSnapshots(),
      context.store.listBrokerOrders(),
      context.store.listTradeIntents(),
      context.store.listMessages(),
    ]);

  return json({
    portfolio: {
      ...(latestSnapshot ?? {
        provider: "alpaca",
        environment: "paper",
        account: {},
        positions: [],
      }),
      account: normalizePortfolioAccountForFrontend(latestSnapshot?.account),
      orders: brokerOrders,
      tradeIntents,
      messages,
      paper: true,
      status: portfolioError ? "offline" : "ok",
      updatedAt: latestSnapshot?.capturedAt,
    },
    snapshot: latestSnapshot ?? null,
    snapshots,
    brokerOrders,
    tradeIntents,
    messages,
    error: portfolioError,
  });
}

async function refreshPortfolio(context: LocalApiContext): Promise<Response> {
  const snapshot = await getTradingBroker(context).getPortfolioSnapshot();
  const stored = await context.store.createPortfolioSnapshot(snapshot);
  const [brokerOrders, tradeIntents, messages] = await Promise.all([
    context.store.listBrokerOrders(),
    context.store.listTradeIntents(),
    context.store.listMessages(),
  ]);
  return json({
    portfolio: {
      ...stored,
      account: normalizePortfolioAccountForFrontend(stored.account),
      orders: brokerOrders,
      tradeIntents,
      messages,
      paper: true,
      status: "ok",
      updatedAt: stored.capturedAt,
    },
    snapshot: stored,
    brokerOrders,
    tradeIntents,
    messages,
  }, 201);
}

async function createTradeIntent(context: LocalApiContext, body: unknown): Promise<Response> {
  const input = createTradeIntentInputSchema.parse(body);
  const branch = input.branchId ? await context.store.getBranch(input.branchId) : undefined;
  const tradingConfig = resolveTradingConfig(input.tradingConfig, branch?.config);
  const policy = evaluateTradingThresholdPolicy({
    confidence: input.confidence,
    tradingConfig,
    branchConfig: branch?.config,
  });

  if (policy.thresholdResult === "below_thresholds") {
    return json({ policy, tradeIntent: null, messages: [] });
  }

  if (policy.thresholdResult === "message_human") {
    const message = await context.store.createMessage({
      type: "threshold_notify",
      severity: "info",
      title: `${input.symbol} crossed notify threshold`,
      body: input.reasoning,
      branchId: input.branchId,
      lawId: input.lawId,
      sourceRunId: input.sourceRunId,
      confidence: input.confidence,
      metadata: { policy },
    });
    return json({ policy, tradeIntent: null, messages: [message] }, 201);
  }

  const tradeIntent = await context.store.createTradeIntent({
    ...input,
    tradingConfig,
    status: "paper_ready",
    mode: "paper",
  });
  const candidateMessage = await context.store.createMessage({
    type: "paper_trade_candidate",
    severity: "action",
    title: `${input.symbol} paper trade candidate`,
    body: policy.paperAutoBuyEnabled
      ? "Confidence crossed the paper threshold. Paper auto-buy is enabled; preflight will run before submission."
      : "Confidence crossed the paper threshold. Paper auto-buy is disabled, so this is recorded as a paper trade intent only.",
    branchId: input.branchId,
    lawId: input.lawId,
    sourceRunId: input.sourceRunId,
    tradeIntentId: tradeIntent.id,
    confidence: input.confidence,
    metadata: { policy },
  });

  if (!policy.paperAutoBuyEnabled) {
    return json({ policy, tradeIntent, messages: [candidateMessage] }, 201);
  }

  const submitted = await submitPaperTradeIntent(context, tradeIntent.id, tradingConfig);
  const submittedBody = await submitted.json();
  return json({
    policy,
    tradeIntent: submittedBody.tradeIntent,
    brokerOrder: submittedBody.brokerOrder,
    messages: [candidateMessage, ...(submittedBody.messages ?? [])],
    preflight: submittedBody.preflight,
  }, submitted.status);
}

async function submitPaperTradeIntent(
  context: LocalApiContext,
  tradeIntentId: string,
  tradingConfig: TradingConfig = {},
): Promise<Response> {
  const tradeIntent = await context.store.getTradeIntent(tradeIntentId);
  if (!tradeIntent) {
    return json({ error: "not_found", message: "Trade intent not found." }, 404);
  }
  const branch = tradeIntent.branchId ? await context.store.getBranch(tradeIntent.branchId) : undefined;
  const resolvedTradingConfig = resolveTradingConfig(tradingConfig, branch?.config);

  const result = await submitPaperOrder(getTradingBroker(context), tradeIntent, resolvedTradingConfig);
  if (!result.preflight.ok || !result.order) {
    const updated = await context.store.updateTradeIntent(tradeIntent.id, {
      status: "blocked",
      metadata: {
        ...tradeIntent.metadata,
        paperOrderPreflight: result.preflight,
      },
    });
    const message = await context.store.createMessage({
      type: "paper_order_blocked",
      severity: "warning",
      title: `${tradeIntent.symbol} paper order blocked`,
      body: result.preflight.reasons.join(" "),
      branchId: tradeIntent.branchId,
      lawId: tradeIntent.lawId,
      sourceRunId: tradeIntent.sourceRunId,
      tradeIntentId: tradeIntent.id,
      confidence: tradeIntent.confidence,
      metadata: { preflight: result.preflight },
    });
    return json({
      tradeIntent: updated,
      brokerOrder: null,
      messages: [message],
      preflight: result.preflight,
    }, 422);
  }

  const brokerOrder = await context.store.createBrokerOrder(result.order);
  const updated = await context.store.updateTradeIntent(tradeIntent.id, {
    status: "paper_submitted",
    metadata: {
      ...tradeIntent.metadata,
      brokerOrderId: brokerOrder.id,
    },
  });
  const message = await context.store.createMessage({
    type: "paper_order_submitted",
    severity: "action",
    title: `${tradeIntent.symbol} paper order submitted`,
    body: `Submitted ${tradeIntent.side} ${tradeIntent.orderType} paper order to Alpaca.`,
    branchId: tradeIntent.branchId,
    lawId: tradeIntent.lawId,
    sourceRunId: tradeIntent.sourceRunId,
    tradeIntentId: tradeIntent.id,
    brokerOrderId: brokerOrder.id,
    confidence: tradeIntent.confidence,
    metadata: { preflight: result.preflight },
  });

  return json({
    tradeIntent: updated,
    brokerOrder,
    messages: [message],
    preflight: result.preflight,
  }, 201);
}

async function streamRunEvents(context: LocalApiContext, runId: string): Promise<Response> {
  const run = await context.store.getRun(runId);
  if (!run) return json({ error: "not_found", message: "Run not found." }, 404);

  const encoder = new TextEncoder();
  const historicalEvents = await context.store.listRunEvents(runId);
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of historicalEvents) {
        controller.enqueue(encoder.encode(formatSseEvent(event)));
      }

      if (context.store.subscribeToRunEvents) {
        unsubscribe = context.store.subscribeToRunEvents(runId, (event) => {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        });
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function getTradingBroker(context: LocalApiContext): PaperTradingBroker {
  context.tradingBroker ??= lazyAlpacaPaperBroker();
  return context.tradingBroker;
}

function lazyAlpacaPaperBroker(): PaperTradingBroker {
  let broker: PaperTradingBroker | undefined;
  const current = () => {
    broker ??= createAlpacaPaperBroker();
    return broker;
  };

  return {
    getPortfolioSnapshot: () => current().getPortfolioSnapshot(),
    getClock: () => current().getClock(),
    getAsset: (symbol) => current().getAsset(symbol),
    submitPaperOrder: (input) => current().submitPaperOrder(input),
  };
}

function deterministicHeartbeat(input: HeartbeatTriggerInput): Promise<HeartbeatRunResult> {
  if (!input.dryRun) {
    throw new Error("Agent pipeline heartbeat is not configured for this local API process.");
  }

  const summary = input.dryRun
    ? `Dry-run heartbeat checked branch ${input.branchId}.`
    : `Local heartbeat placeholder checked branch ${input.branchId}.`;
  return Promise.resolve({
    output: {
      branchId: input.branchId,
      decision: "monitor",
      summary,
      confidence: 0.1,
      dryRun: input.dryRun,
    },
    events: [
      { type: "heartbeat.seeded", payload: { deterministic: true, input: input.payload } },
      { type: "heartbeat.decision", payload: { decision: "monitor", summary } },
    ],
  });
}

function deterministicDebate(input: DebateCreateInput): Promise<DebateCreateResult> {
  if (!input.dryRun) {
    throw new Error("Agent pipeline debate is not configured for this local API process.");
  }

  return Promise.resolve({
    output: {
      decision: "needs_review",
      summary: input.dryRun
        ? "Dry-run debate record created from escalation payload."
        : "Local debate placeholder created from escalation payload.",
      dryRun: input.dryRun,
    },
    events: [
      { type: "debate.created", payload: { deterministic: true, escalation: input.payload.escalation ?? null } },
      { type: "debate.judge.summary", payload: { decision: "needs_review" } },
    ],
  });
}

function branchRunContext(branch: BranchRecord): JsonRecord {
  return {
    id: branch.id,
    lawId: branch.lawId,
    name: branch.name,
    description: branch.description,
    enabled: branch.enabled,
    law: branch.law,
    config: branch.config,
    metadata: branch.metadata,
  };
}

function extractTradingDecision(output: JsonRecord | undefined): {
  confidence: number;
  summary: string;
  citations: unknown[];
} | undefined {
  if (!isJsonRecord(output)) return undefined;
  const confidence =
    typeof output.confidence === "number"
      ? output.confidence
      : typeof output.confidenceScore === "number"
        ? output.confidenceScore
        : undefined;
  const summary = typeof output.summary === "string"
    ? output.summary
    : typeof output.reasoning === "string"
      ? output.reasoning
      : undefined;
  if (confidence === undefined || summary === undefined) return undefined;

  return {
    confidence,
    summary,
    citations: Array.isArray(output.citations) ? output.citations : [],
  };
}

function firstConfiguredSymbol(branch: BranchRecord | undefined): string | undefined {
  return branch?.config?.assets?.[0];
}

function resolveTradingConfig(
  override: TradingConfig | undefined,
  branchConfig: BranchRecord["config"] | undefined,
): TradingConfig {
  return {
    ...branchConfig?.trading,
    ...override,
  };
}

function normalizePortfolioAccountForFrontend(account: unknown): JsonRecord {
  if (!isJsonRecord(account)) return {};
  return {
    ...account,
    cash: account.cash,
    buying_power: account.buyingPower ?? account.buying_power,
    portfolio_value: account.portfolioValue ?? account.portfolio_value,
    equity: account.equity,
    last_equity: account.lastEquity ?? account.last_equity,
    unrealized_pl: account.unrealizedPl ?? account.unrealized_pl,
    daytrade_count: account.daytradeCount ?? account.daytrade_count,
    pattern_day_trader: account.patternDayTrader ?? account.pattern_day_trader,
    account_blocked: account.accountBlocked ?? account.account_blocked,
  };
}

type Route =
  | { name: "health"; params: Record<string, never> }
  | { name: "listOpenRouterModels"; params: Record<string, never> }
  | { name: "listBranches"; params: Record<string, never> }
  | { name: "createBranch"; params: Record<string, never> }
  | { name: "getBranch"; params: { branchId: string } }
  | { name: "updateBranch"; params: { branchId: string } }
  | { name: "deleteBranch"; params: { branchId: string } }
  | { name: "listRuns"; params: Record<string, never> }
  | { name: "getRun"; params: { runId: string } }
  | { name: "listRunEvents"; params: { runId: string } }
  | { name: "triggerHeartbeat"; params: { branchId: string } }
  | { name: "createDebate"; params: Record<string, never> }
  | { name: "appendInterjection"; params: { runId: string } }
  | { name: "streamRunEvents"; params: { runId: string } }
  | { name: "getPortfolio"; params: Record<string, never> }
  | { name: "refreshPortfolio"; params: Record<string, never> }
  | { name: "listMessages"; params: Record<string, never> }
  | { name: "listTradeIntents"; params: Record<string, never> }
  | { name: "createTradeIntent"; params: Record<string, never> }
  | { name: "submitPaperTradeIntent"; params: { tradeIntentId: string } }
  | { name: "listBrokerOrders"; params: Record<string, never> };

function matchRoute(method: string, pathname: string): Route | undefined {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "GET" && pathname === "/health") return { name: "health", params: {} };
  if (method === "GET" && pathname === "/openrouter/models") return { name: "listOpenRouterModels", params: {} };
  if (method === "GET" && pathname === "/portfolio") return { name: "getPortfolio", params: {} };
  if (method === "POST" && pathname === "/portfolio/refresh") return { name: "refreshPortfolio", params: {} };
  if (method === "GET" && pathname === "/messages") return { name: "listMessages", params: {} };
  if (segments.length === 1 && segments[0] === "trade-intents") {
    if (method === "GET") return { name: "listTradeIntents", params: {} };
    if (method === "POST") return { name: "createTradeIntent", params: {} };
  }
  if (method === "POST" && segments.length === 3 && segments[0] === "trade-intents" && segments[2] === "submit-paper") {
    return { name: "submitPaperTradeIntent", params: { tradeIntentId: segments[1] } };
  }
  if (method === "GET" && pathname === "/broker-orders") return { name: "listBrokerOrders", params: {} };
  if (segments.length === 1 && segments[0] === "branches") {
    if (method === "GET") return { name: "listBranches", params: {} };
    if (method === "POST") return { name: "createBranch", params: {} };
  }
  if (segments.length === 2 && segments[0] === "branches") {
    if (method === "GET") return { name: "getBranch", params: { branchId: segments[1] } };
    if (method === "PATCH") return { name: "updateBranch", params: { branchId: segments[1] } };
    if (method === "DELETE") return { name: "deleteBranch", params: { branchId: segments[1] } };
  }
  if (method === "POST" && segments.length === 3 && segments[0] === "branches" && segments[2] === "heartbeat-runs") {
    return { name: "triggerHeartbeat", params: { branchId: segments[1] } };
  }
  if (segments.length === 1 && segments[0] === "runs" && method === "GET") return { name: "listRuns", params: {} };
  if (segments.length === 2 && segments[0] === "runs" && method === "GET") return { name: "getRun", params: { runId: segments[1] } };
  if (segments.length === 3 && segments[0] === "runs" && segments[2] === "events" && method === "GET") {
    return { name: "listRunEvents", params: { runId: segments[1] } };
  }
  if (segments.length === 4 && segments[0] === "runs" && segments[2] === "events" && segments[3] === "stream" && method === "GET") {
    return { name: "streamRunEvents", params: { runId: segments[1] } };
  }
  if (segments.length === 3 && segments[0] === "runs" && segments[2] === "interjections" && method === "POST") {
    return { name: "appendInterjection", params: { runId: segments[1] } };
  }
  if (segments.length === 1 && segments[0] === "debates" && method === "POST") return { name: "createDebate", params: {} };

  return undefined;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json",
    },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: corsHeaders() });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function formatSseEvent(event: { id: string; type: string; timestamp: string; payload: JsonRecord }): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { MemoryKairosStore };
