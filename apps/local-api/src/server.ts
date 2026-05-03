import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { ExaApi } from "../../../src/api/exa.js";
import {
  kairosBranchAgentConfigSchema,
  createSupermemoryMemoryApi,
  createSupermemoryMirror,
  getMemoryContainerTag,
  listOpenRouterModels,
  resolveKairosModelConfig,
  type KairosModelRole,
  type SupermemoryMirror,
} from "../../../src/global/index.js";
import {
  createAlpacaPaperBroker,
  createTradeIntentInputSchema,
  evaluateTradingThresholdPolicy,
  submitPaperOrder,
  tradingConfigSchema,
  type PaperTradingBroker,
  type PortfolioSnapshot,
  type TradeIntent,
  type TradingConfig,
} from "../../../src/trading/index.js";
import {
  createTradingSmsNotifierFromEnv,
  type TradingSmsNotificationInput,
  type TradingSmsNotifier,
} from "../../../src/notifications/index.js";
import { createRuntimeStore } from "./runtime.js";
import {
  MemoryKairosStore,
  type AppendRunEventInput,
  type BranchRecord,
  type KairosLocalStore,
  type JsonRecord,
  type RouterAttachmentRecord,
  type RouterMessageRecord,
  type RouterToolCallRecord,
  type RunRecord,
} from "./store.js";
import { SupabaseKairosStore } from "./supabase-store.js";
import { createSupermemoryMirroredStore } from "./supermemory-store.js";

export type LocalApiDependencies = {
  store?: KairosLocalStore;
  runHeartbeat?: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate?: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  retrieveUrlContents?: (input: RouterUrlRetrieveInput) => Promise<RouterExtractedSource[]>;
  tradingBroker?: PaperTradingBroker;
  notificationSender?: TradingSmsNotifier;
  supermemoryMirror?: SupermemoryMirror;
};

export type LocalApiOptions = {
  dependencies?: LocalApiDependencies;
  dataDir?: string;
};

export type LocalApiContext = {
  store: KairosLocalStore;
  runHeartbeat: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  retrieveUrlContents: (input: RouterUrlRetrieveInput) => Promise<RouterExtractedSource[]>;
  tradingBroker?: PaperTradingBroker;
  notificationSender?: TradingSmsNotifier;
  supermemoryMirror?: SupermemoryMirror;
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

type RouterExtractedSource = {
  id: string;
  kind: "chat_text" | "webpage" | "image" | "pdf";
  text: string;
  ref?: string;
};

type RouterUrlRetrieveInput = {
  urls: string[];
  dryRun: boolean;
};

type RouterSourceExtractionResult = {
  sources: RouterExtractedSource[];
  toolCalls: RouterToolCallRecord[];
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

const routerChatCreateSchema = z.object({
  id: z.string().min(1).optional(),
});

const routerMessageCreateSchema = z.object({
  text: z.string().optional().default(""),
  dryRun: z.boolean().optional().default(true),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        mimeType: z.string().min(1),
        path: z.string().min(1),
      }).strict(),
    )
    .optional()
    .default([]),
});

const paperSubmitSchema = z.object({
  tradingConfig: tradingConfigSchema.optional(),
});

export async function createLocalApiContext(options: LocalApiOptions = {}): Promise<LocalApiContext> {
  const rawStore =
    options.dependencies?.store ??
    (process.env.KAIROS_STORE === "supabase"
      ? new SupabaseKairosStore()
      : await createRuntimeStore({ dataDir: options.dataDir }));
  const supermemoryMirror =
    options.dependencies?.supermemoryMirror ?? createLocalApiSupermemoryMirror();
  const store = createSupermemoryMirroredStore(rawStore, supermemoryMirror, {
    required: process.env.KAIROS_SUPERMEMORY_REQUIRED === "1",
  });
  return {
    store,
    runHeartbeat: options.dependencies?.runHeartbeat ?? deterministicHeartbeat,
    createDebate: options.dependencies?.createDebate ?? deterministicDebate,
    retrieveUrlContents:
      options.dependencies?.retrieveUrlContents ?? defaultRetrieveUrlContents,
    tradingBroker: options.dependencies?.tradingBroker ?? lazyAlpacaPaperBroker(),
    notificationSender:
      options.dependencies?.notificationSender ??
      createTradingSmsNotifierFromEnv(),
    supermemoryMirror,
  };
}

function createLocalApiSupermemoryMirror(): SupermemoryMirror | undefined {
  if (!process.env.SUPERMEMORY_API_KEY) {
    return undefined;
  }

  return createSupermemoryMirror({
    memory: createSupermemoryMemoryApi(),
    required: process.env.KAIROS_SUPERMEMORY_REQUIRED === "1",
    onError(error, record) {
      console.warn(
        `[kairos] Supermemory mirror failed for ${record.scope}.${record.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
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
          return json({
            models: await listOpenRouterModels({ requireTools: true }),
            defaults: openRouterModelDefaults(),
          });

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

        case "listRouterChats":
          return json({ chats: await context.store.listRouterChats() });

        case "createRouterChat":
          return json({
            chat: await context.store.createRouterChat(
              routerChatCreateSchema.parse(await readJson(request)),
            ),
          }, 201);

        case "listRouterMessages": {
          const chat = await context.store.getRouterChat(route.params.chatId);
          if (!chat) return json({ error: "not_found", message: "Router chat not found." }, 404);
          return json({ messages: await context.store.listRouterMessages(route.params.chatId) });
        }

        case "createRouterMessage":
          return await createRouterMessage(context, route.params.chatId, await readJson(request));

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
          return await triggerHeartbeat(context, route.params.branchId, await readJson(request));

        case "createDebate":
          return await createDebate(context, await readJson(request));

        case "appendInterjection":
          return await appendInterjection(context, route.params.runId, await readJson(request));

        case "streamRunEvents":
          return streamRunEvents(context, route.params.runId);

        case "getPortfolio":
          return await getPortfolio(context, url.searchParams);

        case "refreshPortfolio":
          return await refreshPortfolio(context);

        case "listMessages":
          return json({ messages: await context.store.listMessages() });

        case "listTradeIntents":
          return json({ tradeIntents: await context.store.listTradeIntents() });

        case "createTradeIntent":
          return await createTradeIntent(context, await readJson(request));

        case "submitPaperTradeIntent":
          return await submitPaperTradeIntent(
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
  let completed: RunRecord | undefined;
  try {
    completed = await runHeartbeatForBranch(context, branch, {
      dryRun: input.dryRun,
      input: input.input,
      metadataSource: input.dryRun ? "dry_run" : "runtime",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return json({
      run: getFailedRunFromError(error),
      error: "run_failed",
      message,
    }, 500);
  }

  return json({ run: completed }, 201);
}

async function runHeartbeatForBranch(
  context: LocalApiContext,
  branch: BranchRecord,
  options: {
    dryRun: boolean;
    input: JsonRecord;
    metadataSource: string;
  },
): Promise<RunRecord | undefined> {
  const runPayload = {
    ...options.input,
    branch: branchRunContext(branch),
  };
  const run = await context.store.createRun({
    kind: "heartbeat",
    status: "running",
    branchId: branch.id,
    dryRun: options.dryRun,
    input: runPayload,
    metadata: { source: options.metadataSource },
  });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
    payload: { kind: "heartbeat", branchId: branch.id, dryRun: options.dryRun },
  });

  let result: HeartbeatRunResult;
  try {
    result = await context.runHeartbeat({
      branchId: branch.id,
      dryRun: options.dryRun,
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
    throw new Error(message, { cause: failed });
  }
  for (const event of result.events ?? []) {
    await context.store.appendRunEvent(run.id, event);
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  if (completed) {
    await applyTradingPolicyToDebate(context, completed, branch);
  }
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return completed;
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

  const tradeSide =
    decision.action === "buy" || decision.action === "sell"
      ? decision.action
      : undefined;
  if (!tradeSide) {
    if (policy.permittedAction === "message_human") {
      const message = await context.store.createMessage({
        type: "threshold_notify",
        severity: "info",
        title: `Signal marked ${decision.action}`,
        body: decision.summary,
        branchId: branch?.id,
        lawId: branch?.lawId,
        sourceRunId: run.id,
        confidence: decision.confidence,
        metadata: {
          thresholdPolicy: policy,
          action: decision.action,
          citations: decision.citations,
        },
      });
      await sendTradingSmsNotification(context, {
        branchId: branch?.id,
        lawId: branch?.lawId,
        runId: run.id,
        symbol: firstConfiguredSymbol(branch),
        confidence: decision.confidence,
        threshold: policy.notifyThreshold,
        finalAnswer: decision.summary,
        permittedAction: policy.permittedAction,
        debateTranscript: await context.store.listRunEvents(run.id),
      }, {
        branchId: branch?.id,
        lawId: branch?.lawId,
        sourceRunId: run.id,
        tradeIntentId: message.tradeIntentId,
        confidence: decision.confidence,
      });
    }
    return;
  }

  const messageType =
    policy.permittedAction === "message_human"
      ? "threshold_notify"
      : "paper_trade_candidate";
  let intent: TradeIntent | undefined;

  if (
    policy.permittedAction === "paper_trade_intent" ||
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

    const portfolioSnapshot = await context.store.latestPortfolioSnapshot();
    const currentPosition = findPortfolioPosition(portfolioSnapshot, symbol);
    if (tradeSide === "sell" && (currentPosition?.qty ?? 0) <= 0) {
      await context.store.createMessage({
        type: "paper_order_blocked",
        severity: "warning",
        title: `${symbol} paper sell blocked`,
        body: "The debate selected sell, but Kairos has no cached position for this symbol. Refresh the portfolio before creating a sell intent.",
        branchId: branch?.id,
        lawId: branch?.lawId,
        sourceRunId: run.id,
        confidence: decision.confidence,
        metadata: {
          thresholdPolicy: policy,
          action: decision.action,
          portfolioContext: compactPortfolioContext(portfolioSnapshot),
        },
      });
      return;
    }

    const defaultNotional =
      tradingConfig.maxNotionalPerOrder ??
      tradingConfig.maxNotionalUsd ??
      500;
    intent = await context.store.createTradeIntent({
      branchId: branch?.id,
      lawId: branch?.lawId,
      sourceRunId: run.id,
      symbol,
      side: tradeSide,
      qty: tradeSide === "sell" ? currentPosition?.qty : undefined,
      notional: tradeSide === "buy" ? defaultNotional : undefined,
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
      positionSizingRationale:
        tradeSide === "buy"
          ? `Uses configured max paper notional ${defaultNotional}.`
          : `Uses cached ${symbol} paper position quantity ${currentPosition?.qty}.`,
      invalidationCondition: "Evidence is stale, contradicted, immaterial, or already priced in.",
      exitCondition: "Manual review or future branch-specific exit law.",
      approvalsRequired:
        policy.permittedAction === "paper_order" ? [] : ["paper_auto_trade_disabled"],
      status: policy.permittedAction === "paper_order" ? "paper_ready" : "draft",
      tradingConfig,
      metadata: {
        thresholdPolicy: policy,
        action: decision.action,
        autoTradeEnabled: policy.paperAutoTradeEnabled,
        portfolioContext: compactPortfolioContext(portfolioSnapshot),
      },
    });

    await context.store.appendRunEvent(run.id, {
      type: "trading.intent.created",
      payload: { tradeIntentId: intent.id, permittedAction: policy.permittedAction },
    });
  }

  const thresholdMessage = await context.store.createMessage({
    type: messageType,
    severity: policy.permittedAction === "message_human" ? "info" : "action",
    title:
      policy.permittedAction === "message_human"
        ? "Signal crossed notification threshold"
        : `${tradeSide.toUpperCase()} signal crossed paper trade threshold`,
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
  await sendTradingSmsNotification(context, {
    branchId: branch?.id,
    lawId: branch?.lawId,
    runId: run.id,
    symbol: intent?.symbol ?? firstConfiguredSymbol(branch),
    confidence: decision.confidence,
    threshold: policy.notifyThreshold,
    finalAnswer: decision.summary,
    permittedAction: policy.permittedAction,
    tradeIntent: intent,
    debateTranscript: await context.store.listRunEvents(run.id),
  }, {
    branchId: branch?.id,
    lawId: branch?.lawId,
    sourceRunId: run.id,
    tradeIntentId: intent?.id ?? thresholdMessage.tradeIntentId,
    confidence: decision.confidence,
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
  const portfolioContext = compactPortfolioContext(
    await context.store.latestPortfolioSnapshot(),
  );
  const runPayload = {
    ...payload,
    ...(portfolioContext ? { portfolioContext } : {}),
    ...(branch ? { branch: branchRunContext(branch) } : {}),
  };
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

async function createRouterMessage(
  context: LocalApiContext,
  chatId: string,
  body: unknown,
): Promise<Response> {
  const chat = await context.store.getRouterChat(chatId);
  if (!chat) return json({ error: "not_found", message: "Router chat not found." }, 404);

  const input = routerMessageCreateSchema.parse(body);
  if (!input.text.trim() && input.attachments.length === 0) {
    return json({ error: "bad_request", message: "Router message is empty." }, 400);
  }

  const userMessage = await context.store.createRouterMessage({
    chatId,
    role: "user",
    text: input.text.trim() || undefined,
    attachments: input.attachments,
  });
  const run = await context.store.createRun({
    kind: "router",
    status: "running",
    dryRun: input.dryRun,
    input: {
      chatId,
      messageId: userMessage.id,
      text: userMessage.text,
      attachments: userMessage.attachments ?? [],
    },
    metadata: { source: input.dryRun ? "dry_run" : "runtime" },
  });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
    payload: { kind: "router", chatId, dryRun: input.dryRun },
  });
  await context.store.appendRunEvent(run.id, {
    type: "router.message.received",
    payload: { chatId, messageId: userMessage.id },
  });

  try {
    const extraction = await extractRouterSources(context, input, userMessage);
    const { sources } = extraction;
    const toolCalls = [...extraction.toolCalls];
    for (const toolCall of extraction.toolCalls) {
      await context.store.appendRunEvent(run.id, {
        type:
          toolCall.status === "failed"
            ? "router.tool_call.failed"
            : "router.tool_call.completed",
        payload: toolCall,
      });
    }
    await context.store.appendRunEvent(run.id, {
      type: "router.sources.extracted",
      payload: { sources },
    });

    const branches = await context.store.listBranches();
    const branchInventory = branches.map((branch) => ({
      id: branch.id,
      text: branchInventoryText(branch),
      enabled: branch.enabled,
    }));
    const inventoryToolCall = createRouterToolCall({
      name: "branch_inventory",
      status: "succeeded",
      summary: `Loaded ${branchInventory.filter((branch) => branch.enabled).length} enabled branches from ${branchInventory.length} total branches.`,
      output: { branches: branchInventory },
    });
    toolCalls.push(inventoryToolCall);
    await context.store.appendRunEvent(run.id, {
      type: "router.tool_call.completed",
      payload: inventoryToolCall,
    });

    const selectedBranchIds = routeToBranches(userMessage.text ?? "", sources, branches);
    await context.store.appendRunEvent(run.id, {
      type: "router.route.selected",
      payload: { branchIds: selectedBranchIds },
    });
    const mirroredSources = await mirrorRouterSources(context, {
      runId: run.id,
      chatId,
      messageId: userMessage.id,
      branchIds: selectedBranchIds,
      sources,
      attachments: userMessage.attachments ?? [],
    });
    if (mirroredSources) {
      await context.store.appendRunEvent(run.id, {
        type: "router.sources.mirrored",
        payload: { sourceCount: sources.length, branchIds: selectedBranchIds },
      });
    }

    const heartbeatRuns: RunRecord[] = [];
    for (const branchId of selectedBranchIds) {
      const branch = branches.find((item) => item.id === branchId);
      if (!branch) continue;
      const heartbeatRun = await runHeartbeatForBranch(context, branch, {
        dryRun: input.dryRun,
        input: {
          origin: "router",
          messageText: userMessage.text,
          sources,
          promptModifier:
            "This run was triggered by human-routed information. Evaluate only whether this information is relevant, novel, and potentially escalation-worthy for this branch's law. Do not trade. Do not assume the human is correct.",
        },
        metadataSource: "router",
      });
      if (heartbeatRun) {
        heartbeatRuns.push(heartbeatRun);
        const heartbeatToolCall = createRouterToolCall({
          name: "heartbeat_wakeup",
          status: "succeeded",
          summary: `Woke ${branchId} for heartbeat evaluation with router-origin context.`,
          input: { branchId },
          output: { runId: heartbeatRun.id, status: heartbeatRun.status },
        });
        toolCalls.push(heartbeatToolCall);
        await context.store.appendRunEvent(run.id, {
          type: "router.heartbeat_triggered",
          payload: { branchId, runId: heartbeatRun.id, toolCall: heartbeatToolCall },
        });
      }
    }

    const output = {
      branchIds: selectedBranchIds,
      response: routerResponse(selectedBranchIds, sources, {
        enabledBranches: branchInventory.filter((branch) => branch.enabled).length,
        totalBranches: branchInventory.length,
      }),
    };
    const completed = await context.store.updateRun(run.id, {
      status: "succeeded",
      output,
    });
    const assistantMessage = await context.store.createRouterMessage({
      chatId,
      role: "assistant",
      text: output.response,
      runId: run.id,
      toolCalls,
    });
    await context.store.appendRunEvent(run.id, {
      type: "router.response.created",
      payload: { messageId: assistantMessage.id },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.completed",
      payload: { status: "succeeded" },
    });

    return json({
      userMessage,
      assistantMessage,
      run: completed,
      heartbeatRuns,
    }, 201);
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
}

async function getPortfolio(
  context: LocalApiContext,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (searchParams.get("refresh") === "true") {
    try {
      return await refreshPortfolio(context);
    } catch (error) {
      return portfolioSnapshotResponse(
        context,
        error instanceof Error ? error.message : "Unable to refresh Alpaca portfolio.",
        true,
      );
    }
  }

  return portfolioSnapshotResponse(context, "No cached Alpaca portfolio snapshot.");
}

async function portfolioSnapshotResponse(
  context: LocalApiContext,
  fallbackError: string,
  reportFallbackWithCachedSnapshot = false,
): Promise<Response> {
  const latestSnapshot = await context.store.latestPortfolioSnapshot();
  const portfolioError = latestSnapshot && !reportFallbackWithCachedSnapshot
    ? undefined
    : fallbackError;

  const [snapshots, brokerOrders, tradeIntents, messages] =
    await Promise.all([
      context.store.listPortfolioSnapshots(),
      context.store.listBrokerOrders(),
      context.store.listTradeIntents(),
      context.store.listMessages(),
    ]);
  const storage = portfolioStorageStatus({ brokerOrders, tradeIntents, messages });

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
      storage,
      paper: true,
      status: portfolioError ? "offline" : "ok",
      updatedAt: latestSnapshot?.capturedAt,
    },
    snapshot: latestSnapshot ?? null,
    snapshots,
    brokerOrders,
    tradeIntents,
    messages,
    storage,
    error: portfolioError,
  });
}

async function refreshPortfolio(context: LocalApiContext): Promise<Response> {
  const broker = getTradingBroker(context);
  const snapshot = await broker.getPortfolioSnapshot();
  const stored = await context.store.createPortfolioSnapshot(snapshot);
  await syncPaperBrokerOrders(context, broker);
  const [brokerOrders, tradeIntents, messages] = await Promise.all([
    context.store.listBrokerOrders(),
    context.store.listTradeIntents(),
    context.store.listMessages(),
  ]);
  const storage = portfolioStorageStatus({ brokerOrders, tradeIntents, messages });

  return json({
    portfolio: {
      ...stored,
      account: normalizePortfolioAccountForFrontend(stored.account),
      orders: brokerOrders,
      tradeIntents,
      messages,
      storage,
      paper: true,
      status: "ok",
      updatedAt: stored.capturedAt,
    },
    snapshot: stored,
    brokerOrders,
    tradeIntents,
    messages,
    storage,
  }, 201);
}

async function syncPaperBrokerOrders(
  context: LocalApiContext,
  broker: PaperTradingBroker,
): Promise<void> {
  if (!broker.listPaperOrders) {
    return;
  }

  const orders = await broker.listPaperOrders({ status: "all", limit: 100 });
  await Promise.all(orders.map((order) => context.store.createBrokerOrder(order)));
}

function portfolioStorageStatus(input: {
  brokerOrders: unknown[];
  tradeIntents: unknown[];
  messages: unknown[];
}): JsonRecord {
  return {
    persistent: true,
    mode: "paper",
    store: "kairos_runtime_store",
    scope: "paper_trading_audit",
    detail:
      "Kairos stores paper trade intents, submitted paper broker orders, trading messages, and portfolio snapshots in the configured runtime store.",
    brokerOrderCount: input.brokerOrders.length,
    tradeIntentCount: input.tradeIntents.length,
    messageCount: input.messages.length,
  };
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
    await sendTradingSmsNotification(context, {
      branchId: input.branchId,
      lawId: input.lawId,
      runId: input.sourceRunId,
      symbol: input.symbol,
      confidence: input.confidence,
      threshold: policy.notifyThreshold,
      finalAnswer: input.reasoning,
      permittedAction: policy.permittedAction,
      debateTranscript: [input],
    }, {
      branchId: input.branchId,
      lawId: input.lawId,
      sourceRunId: input.sourceRunId,
      confidence: input.confidence,
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
    body: policy.paperAutoTradeEnabled
      ? "Confidence crossed the paper threshold. Paper auto-trading is enabled; preflight will run before submission."
      : "Confidence crossed the paper threshold. Paper auto-trading is disabled, so this is recorded as a paper trade intent only.",
    branchId: input.branchId,
    lawId: input.lawId,
    sourceRunId: input.sourceRunId,
    tradeIntentId: tradeIntent.id,
    confidence: input.confidence,
    metadata: { policy },
  });
  await sendTradingSmsNotification(context, {
    branchId: input.branchId,
    lawId: input.lawId,
    runId: input.sourceRunId,
    symbol: input.symbol,
    confidence: input.confidence,
    threshold: policy.notifyThreshold,
    finalAnswer: input.reasoning,
    permittedAction: policy.permittedAction,
    tradeIntent,
    debateTranscript: [input],
  }, {
    branchId: input.branchId,
    lawId: input.lawId,
    sourceRunId: input.sourceRunId,
    tradeIntentId: tradeIntent.id,
    confidence: input.confidence,
  });

  if (!policy.paperAutoTradeEnabled) {
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

async function sendTradingSmsNotification(
  context: LocalApiContext,
  input: TradingSmsNotificationInput,
  messageContext: {
    branchId?: string;
    lawId?: string;
    sourceRunId?: string;
    tradeIntentId?: string;
    confidence?: number;
  },
): Promise<void> {
  if (!context.notificationSender) {
    return;
  }

  try {
    const result = await context.notificationSender.send(input);
    await context.store.createMessage({
      type: "sms_notification_sent",
      severity: "info",
      title: "SMS notification sent",
      body: result.body,
      branchId: messageContext.branchId,
      lawId: messageContext.lawId,
      sourceRunId: messageContext.sourceRunId,
      tradeIntentId: messageContext.tradeIntentId,
      confidence: messageContext.confidence,
      metadata: {
        provider: result.provider,
        sid: result.sid,
        status: result.status,
      },
    });
  } catch (error) {
    await context.store.createMessage({
      type: "sms_notification_failed",
      severity: "warning",
      title: "SMS notification failed",
      body: error instanceof Error ? error.message : "Unknown SMS notification error.",
      branchId: messageContext.branchId,
      lawId: messageContext.lawId,
      sourceRunId: messageContext.sourceRunId,
      tradeIntentId: messageContext.tradeIntentId,
      confidence: messageContext.confidence,
    });
  }
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

async function mirrorRouterSources(
  context: LocalApiContext,
  input: {
    runId: string;
    chatId: string;
    messageId: string;
    branchIds: string[];
    sources: RouterExtractedSource[];
    attachments: RouterAttachmentRecord[];
  },
): Promise<boolean> {
  if (!context.supermemoryMirror) return false;

  const containerTags = input.branchIds.map((branchId) =>
    [
      getMemoryContainerTag({ scopeId: branchId, prefix: "branch" }),
      getMemoryContainerTag({ scopeId: branchId, prefix: "branch_profile" }),
    ],
  ).flat();

  await Promise.all(
    input.sources.map((source) =>
      context.supermemoryMirror!.mirrorRecord({
        type: "router.source.ingested",
        scope: "source",
        runId: input.runId,
        artifactId: source.id,
        actor: "router",
        source: "router_agent",
        title: `Kairos router ${source.kind}`,
        summary: compactRouterSourceSummary(source),
        content: source.text,
        data: {
          chatId: input.chatId,
          messageId: input.messageId,
          source,
          attachments: input.attachments,
          branchIds: input.branchIds,
        },
        metadata: {
          source_kind: source.kind,
          source_ref: source.ref,
          routed_branch_count: input.branchIds.length,
        },
        containerTags,
        customId: `kairos:router:${input.runId}:source:${source.id}`,
      }),
    ),
  );
  return true;
}

function compactRouterSourceSummary(source: RouterExtractedSource): string {
  const ref = source.ref ? ` ${source.ref}` : "";
  const text = source.text.replace(/\s+/g, " ").trim();
  return `${source.kind}${ref}: ${text.slice(0, 240)}`;
}

async function extractRouterSources(
  context: LocalApiContext,
  input: z.infer<typeof routerMessageCreateSchema>,
  message: RouterMessageRecord,
): Promise<RouterSourceExtractionResult> {
  const sources: RouterExtractedSource[] = [];
  const toolCalls: RouterToolCallRecord[] = [];
  if (message.text) {
    sources.push({
      id: "chat_text",
      kind: "chat_text",
      text: message.text,
    });
  }

  const urls = extractUrls(message.text ?? "");
  if (urls.length > 0) {
    try {
      const webpageSources = await context.retrieveUrlContents({
        urls,
        dryRun: input.dryRun,
      });
      sources.push(...webpageSources);
      const toolCall = createRouterToolCall({
        name: "exa_contents",
        status: input.dryRun ? "skipped" : "succeeded",
        summary: input.dryRun
          ? `Preserved ${urls.length} URL${urls.length === 1 ? "" : "s"} without live Exa retrieval because this was a dry run.`
          : `Retrieved ${webpageSources.length} webpage source${webpageSources.length === 1 ? "" : "s"} through Exa contents.`,
        input: { urls },
        output: {
          sourceIds: webpageSources.map((source) => source.id),
          characterCount: webpageSources.reduce(
            (sum, source) => sum + source.text.length,
            0,
          ),
        },
      });
      toolCalls.push(toolCall);
    } catch (error) {
      const toolCall = createRouterToolCall({
        name: "exa_contents",
        status: "failed",
        summary: "Exa contents retrieval failed. The original URL remains in the submitted chat text.",
        input: { urls },
        error: error instanceof Error ? error.message : String(error),
      });
      toolCalls.push(toolCall);
    }
  }

  for (const attachment of input.attachments) {
    sources.push(attachmentSource(attachment));
  }

  return { sources, toolCalls };
}

function createRouterToolCall(input: {
  name: string;
  status: RouterToolCallRecord["status"];
  summary: string;
  input?: JsonRecord;
  output?: JsonRecord;
  error?: string;
}): RouterToolCallRecord {
  return {
    id: randomUUID(),
    name: input.name,
    status: input.status,
    summary: input.summary,
    input: input.input,
    output: input.output,
    error: input.error,
    createdAt: new Date().toISOString(),
  };
}

function attachmentSource(attachment: RouterAttachmentRecord): RouterExtractedSource {
  if (attachment.mimeType === "application/pdf") {
    return {
      id: attachment.id,
      kind: "pdf",
      ref: attachment.id,
      text: `PDF attachment preserved for extraction: ${attachment.name}`,
    };
  }

  if (attachment.mimeType.startsWith("image/")) {
    return {
      id: attachment.id,
      kind: "image",
      ref: attachment.id,
      text: `Image attachment preserved for extraction: ${attachment.name}`,
    };
  }

  return {
    id: attachment.id,
    kind: "chat_text",
    ref: attachment.id,
    text: `Attachment preserved for extraction: ${attachment.name}`,
  };
}

async function defaultRetrieveUrlContents(
  input: RouterUrlRetrieveInput,
): Promise<RouterExtractedSource[]> {
  if (input.urls.length === 0) return [];
  if (input.dryRun || !process.env.EXA_API_KEY) {
    return input.urls.map((url, index) => ({
      id: `webpage_${index + 1}`,
      kind: "webpage" as const,
      ref: url,
      text: url,
    }));
  }

  const response = await new ExaApi().contents({
    urls: input.urls,
    maxCharacters: 6000,
  });

  return response.results.map((result, index) => ({
    id: result.id ?? `webpage_${index + 1}`,
    kind: "webpage" as const,
    ref: result.url,
    text: result.text ?? result.summary ?? result.highlights?.join("\n") ?? result.url,
  }));
}

function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s)]+/g) ?? [])].map((url) =>
    url.replace(/[.,;:!?]+$/, ""),
  );
}

function routeToBranches(
  messageText: string,
  sources: RouterExtractedSource[],
  branches: BranchRecord[],
): string[] {
  const submittedText = normalizeText([
    messageText,
    ...sources.map((source) => source.text),
  ].join(" "));
  if (!submittedText) return [];

  return branches
    .filter((branch) => branch.enabled)
    .filter((branch) => branchMatchesText(branch, submittedText))
    .map((branch) => branch.id);
}

function branchMatchesText(branch: BranchRecord, submittedText: string): boolean {
  const branchText = branchInventoryText(branch);
  const branchTokens = meaningfulTokens(branchText);
  const submittedTokens = meaningfulTokens(submittedText);
  const tokenOverlap = [...branchTokens].filter((token) =>
    submittedTokens.has(token),
  ).length;
  const assetMatch = (branch.config?.assets ?? []).some((asset) =>
    submittedText.includes(normalizeText(asset)),
  );
  const idMatch = submittedText.includes(normalizeText(branch.id));
  return idMatch || assetMatch || tokenOverlap >= 2;
}

function branchInventoryText(branch: BranchRecord): string {
  return normalizeText([
    branch.id,
    branch.name,
    branch.description,
    JSON.stringify(branch.law ?? {}),
    (branch.config?.assets ?? []).join(" "),
  ].join(" "));
}

function meaningfulTokens(text: string): Set<string> {
  const ignored = new Set([
    "and",
    "for",
    "the",
    "this",
    "that",
    "with",
    "from",
    "branch",
    "law",
    "watch",
    "watches",
  ]);
  return new Set(
    normalizeText(text)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !ignored.has(token)),
  );
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function routerResponse(
  branchIds: string[],
  sources: RouterExtractedSource[],
  inventory: { enabledBranches: number; totalBranches: number },
): string {
  if (inventory.totalBranches === 0) {
    return "Thanks. I read it, but there are no branches yet, so I could not route it anywhere. Create a branch first, then resend this source or paste it into that branch's law.";
  }

  if (inventory.enabledBranches === 0) {
    return "Thanks. I read it, but every branch is disabled, so I could not wake a heartbeat agent. Enable a branch first, then resend this source.";
  }

  if (branchIds.length === 0) {
    return "Thanks. I read it, but I did not send it to any branch. It does not match the current branch laws closely enough.";
  }

  const sourceKinds = [...new Set(sources.map((source) => source.kind))].join(", ");
  return [
    "Thanks. I sent this to:",
    ...branchIds.map((branchId) => `- ${branchId}`),
    "",
    `I used the submitted ${sourceKinds || "message"} and woke the heartbeat agent for each selected branch.`,
  ].join("\n");
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

function getFailedRunFromError(error: unknown): RunRecord | undefined {
  return error instanceof Error && isJsonRecord(error.cause)
    ? error.cause as RunRecord
    : undefined;
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

function compactPortfolioContext(
  snapshot: PortfolioSnapshot | undefined,
): JsonRecord | undefined {
  if (!snapshot) return undefined;

  return {
    capturedAt: snapshot.capturedAt,
    provider: snapshot.provider,
    environment: snapshot.environment,
    account: {
      status: snapshot.account.status,
      cash: snapshot.account.cash,
      buyingPower: snapshot.account.buyingPower,
      portfolioValue: snapshot.account.portfolioValue,
      equity: snapshot.account.equity,
      unrealizedPl: snapshot.account.unrealizedPl,
      daytradeCount: snapshot.account.daytradeCount,
      patternDayTrader: snapshot.account.patternDayTrader,
      tradingBlocked: snapshot.account.tradingBlocked,
      accountBlocked: snapshot.account.accountBlocked,
    },
    positions: snapshot.positions.map((position) => ({
      symbol: position.symbol,
      qty: position.qty,
      marketValue: position.marketValue,
      costBasis: position.costBasis,
      unrealizedPl: position.unrealizedPl,
      unrealizedPlpc: position.unrealizedPlpc,
      currentPrice: position.currentPrice,
      side: position.side,
    })),
  };
}

function findPortfolioPosition(
  snapshot: PortfolioSnapshot | undefined,
  symbol: string,
): PortfolioSnapshot["positions"][number] | undefined {
  return snapshot?.positions.find(
    (position) => position.symbol.toUpperCase() === symbol.toUpperCase(),
  );
}

function extractTradingDecision(output: JsonRecord | undefined): {
  confidence: number;
  summary: string;
  action: "buy" | "sell" | "watch" | "research" | "no_action";
  citations: unknown[];
} | undefined {
  if (!isJsonRecord(output)) return undefined;
  const decisionObject = isJsonRecord(output.finalDecision)
    ? output.finalDecision
    : output;
  const confidence =
    typeof decisionObject.confidence === "number"
      ? decisionObject.confidence
      : typeof decisionObject.confidenceScore === "number"
        ? decisionObject.confidenceScore
        : undefined;
  const summary = typeof decisionObject.summary === "string"
    ? decisionObject.summary
    : typeof decisionObject.reasoning === "string"
      ? decisionObject.reasoning
      : undefined;
  const action = normalizeTradingDecisionAction(decisionObject.action);
  if (confidence === undefined || summary === undefined) return undefined;

  return {
    confidence,
    summary,
    action,
    citations: Array.isArray(decisionObject.citations) ? decisionObject.citations : [],
  };
}

function normalizeTradingDecisionAction(
  action: unknown,
): "buy" | "sell" | "watch" | "research" | "no_action" {
  return action === "buy" ||
    action === "sell" ||
    action === "watch" ||
    action === "research" ||
    action === "no_action"
    ? action
    : "watch";
}

function firstConfiguredSymbol(branch: BranchRecord | undefined): string | undefined {
  return branch?.config?.trading?.symbols?.[0] ??
    branch?.config?.trading?.symbol ??
    branch?.config?.assets?.[0];
}

function openRouterModelDefaults(): JsonRecord {
  const roles: KairosModelRole[] = [
    "heartbeat",
    "informationPlanner",
    "informationSynthesis",
    "debateJudge",
    "debateBull",
    "debateBear",
    "debateFinal",
  ];

  return Object.fromEntries(
    roles.map((role) => {
      const config = resolveKairosModelConfig(role);
      return [
        role,
        {
          model: config.model,
          reasoningEffort: config.reasoning?.effort,
        },
      ];
    }),
  );
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
  | { name: "listRouterChats"; params: Record<string, never> }
  | { name: "createRouterChat"; params: Record<string, never> }
  | { name: "listRouterMessages"; params: { chatId: string } }
  | { name: "createRouterMessage"; params: { chatId: string } }
  | { name: "getRun"; params: { runId: string } }
  | { name: "listRunEvents"; params: { runId: string } }
  | { name: "triggerHeartbeat"; params: { branchId: string } }
  | { name: "createDebate"; params: Record<string, never> }
  | { name: "appendInterjection"; params: { runId: string } }
  | { name: "streamRunEvents"; params: { runId: string } }
  | { name: "getPortfolio"; params: Record<string, never> }
  | { name: "refreshPortfolio"; params: Record<string, never> }
  | { name: "listRouterChats"; params: Record<string, never> }
  | { name: "createRouterChat"; params: Record<string, never> }
  | { name: "listRouterMessages"; params: { chatId: string } }
  | { name: "createRouterMessage"; params: { chatId: string } }
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
  if (segments.length === 2 && segments[0] === "router" && segments[1] === "chats") {
    if (method === "GET") return { name: "listRouterChats", params: {} };
    if (method === "POST") return { name: "createRouterChat", params: {} };
  }
  if (segments.length === 4 && segments[0] === "router" && segments[1] === "chats" && segments[3] === "messages") {
    if (method === "GET") return { name: "listRouterMessages", params: { chatId: segments[2] } };
    if (method === "POST") return { name: "createRouterMessage", params: { chatId: segments[2] } };
  }
  if (method === "GET" && pathname === "/messages") return { name: "listMessages", params: {} };
  if (segments.length === 1 && segments[0] === "trade-intents") {
    if (method === "GET") return { name: "listTradeIntents", params: {} };
    if (method === "POST") return { name: "createTradeIntent", params: {} };
  }
  if (method === "POST" && segments.length === 3 && segments[0] === "trade-intents" && segments[2] === "submit-paper") {
    return { name: "submitPaperTradeIntent", params: { tradeIntentId: segments[1] } };
  }
  if (method === "GET" && pathname === "/broker-orders") return { name: "listBrokerOrders", params: {} };
  if (segments.length === 2 && segments[0] === "router" && segments[1] === "chats") {
    if (method === "GET") return { name: "listRouterChats", params: {} };
    if (method === "POST") return { name: "createRouterChat", params: {} };
  }
  if (segments.length === 4 && segments[0] === "router" && segments[1] === "chats" && segments[3] === "messages") {
    if (method === "GET") return { name: "listRouterMessages", params: { chatId: segments[2] } };
    if (method === "POST") return { name: "createRouterMessage", params: { chatId: segments[2] } };
  }
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

export { MemoryKairosStore, SupabaseKairosStore };
