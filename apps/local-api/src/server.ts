import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  createAlpacaTradingClient,
  type AlpacaMarketSymbol,
  type AlpacaMarketSymbolQuery,
} from "../../../src/api/alpaca.js";
import { ExaApi } from "../../../src/api/exa.js";
import { FinnhubApi } from "../../../src/api/finnhub.js";
import {
  createInformationDebateTools,
} from "../../../src/agents/information/index.js";
import {
  createHeartbeatSeedProviders,
  createHeartbeatTools,
  runHeartbeatOnce,
  type BranchConfig as HeartbeatBranchConfig,
  type HeartbeatToolName,
} from "../../../src/agents/heartbeat/index.js";
import {
  runDebateAgent,
  type DebateMessage,
  type HumanInterjection,
  type DebateRunConfig,
  type DebateRunResult,
  type DebateStartInput,
  type StructuredDebateModelProvider,
} from "../../../src/agents/debate/index.js";
import type { StructuredInformationModelProvider } from "../../../src/agents/information/index.js";
import {
  branchConfigToModelOverrides,
  createGlobalToolRegistry,
  createOpenRouterAiSdkModelForRole,
  createOpenRouterChatModelForRole,
  kairosBranchAgentConfigSchema,
  createSupermemoryMemoryApi,
  createSupermemoryMirror,
  getMemoryContainerTag,
  listOpenRouterModels,
  resolveDebateAgentConfig,
  resolveInformationAgentConfig,
  resolveKairosModelConfig,
  isProbablyOpenRouterToolCapableModel,
  type KairosModelRole,
  type KairosBranchAgentConfig,
  type SupermemoryMirror,
} from "../../../src/global/index.js";
import {
  createAlpacaTradingBroker,
  createTradeIntentInputSchema,
  evaluateTradingThresholdPolicy,
  submitOrder,
  tradingConfigSchema,
  type TradingBroker,
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
  buildRouterChatTitle,
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
import {
  handleDeepResearchRequest,
  runDeepResearchQuery,
  type DeepResearchContext,
} from "./deep-research.js";

export type LocalApiDependencies = {
  store?: KairosLocalStore;
  runHeartbeat?: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate?: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  retrieveUrlContents?: (input: RouterUrlRetrieveInput) => Promise<RouterExtractedSource[]>;
  tradingBroker?: TradingBroker;
  marketSymbolProvider?: MarketSymbolProvider;
  notificationSender?: TradingSmsNotifier;
  supermemoryMirror?: SupermemoryMirror;
};

export type LocalApiOptions = {
  dependencies?: LocalApiDependencies;
  dataDir?: string;
};

type DebateCancelState = {
  canceled: boolean;
};

export type LocalApiContext = {
  store: KairosLocalStore;
  runHeartbeat: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate: (input: DebateCreateInput) => Promise<DebateCreateResult>;
  retrieveUrlContents: (input: RouterUrlRetrieveInput) => Promise<RouterExtractedSource[]>;
  tradingBroker?: TradingBroker;
  marketSymbolProvider?: MarketSymbolProvider;
  notificationSender?: TradingSmsNotifier;
  supermemoryMirror?: SupermemoryMirror;
  debateCancelStates: Map<string, DebateCancelState>;
};

type HeartbeatTriggerInput = {
  branchId: string;
  payload: JsonRecord;
  branch: BranchRecord;
};

type HeartbeatRunResult = {
  output: JsonRecord;
  events?: AppendRunEventInput[];
};

type DebateCreateInput = {
  payload: JsonRecord;
  branch?: BranchRecord;
  deepResearchContext?: DeepResearchContext;
  context?: LocalApiContext;
  runId?: string;
  onProgress?: (event: AppendRunEventInput) => Promise<void> | void;
  isCanceled?: () => boolean;
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
};

type MarketSymbolProvider = {
  listMarketSymbols: (input: AlpacaMarketSymbolQuery) => Promise<AlpacaMarketSymbol[]>;
  getMarketSymbols?: (symbols: string[]) => Promise<AlpacaMarketSymbol[]>;
};

type RouterSourceExtractionResult = {
  sources: RouterExtractedSource[];
  toolCalls: RouterToolCallRecord[];
};

const DEFAULT_MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 600;
const LOCAL_REQUEST_HEADER = "x-kairos-local-request";
const LOCAL_TOKEN_HEADER = "x-kairos-local-token";
const REQUEST_ID_HEADER = "x-request-id";
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENCY_CACHE_TTL_MS = 10 * 60_000;
const SENSITIVE_RESPONSE_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key|stack)/i;

type RequestLogContext = {
  requestId: string;
  startedAt: number;
  method: string;
  path: string;
};

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

type CachedIdempotentResponse = {
  expiresAt: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
};

const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
const rateLimitBuckets = new Map<string, RateLimitBucket>();
const idempotencyResponses = new Map<string, CachedIdempotentResponse>();

class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds the configured ${maxBytes} byte limit.`);
    this.name = "RequestBodyTooLargeError";
  }
}

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
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const debateCreateSchema = z.object({
  async: z.boolean().optional().default(false),
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
  title: z.string().min(1).optional(),
});

const routerMessageCreateSchema = z.object({
  text: z.string().optional().default(""),
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

const semanticSymbolSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(200).optional().default(50),
});

type CapabilityCheck = {
  id: string;
  label: string;
  status: "ready" | "warning" | "blocked";
  detail: string;
};

export async function createLocalApiContext(options: LocalApiOptions = {}): Promise<LocalApiContext> {
  const rawStore =
    options.dependencies?.store ??
    (process.env.KAIROS_STORE === "supabase"
      ? new SupabaseKairosStore()
      : await createRuntimeStore({ dataDir: options.dataDir }));
  const supermemoryMirror =
    options.dependencies?.supermemoryMirror ?? createLocalApiSupermemoryMirror();
  const debateCancelStates = new Map<string, DebateCancelState>();
  const store = createSupermemoryMirroredStore(rawStore, supermemoryMirror, {
    required: process.env.KAIROS_SUPERMEMORY_REQUIRED === "1",
  });
  return {
    store,
    runHeartbeat: options.dependencies?.runHeartbeat ?? runConfiguredHeartbeat,
    createDebate: options.dependencies?.createDebate ?? runConfiguredDebate,
    retrieveUrlContents:
      options.dependencies?.retrieveUrlContents ?? defaultRetrieveUrlContents,
    tradingBroker: options.dependencies?.tradingBroker ?? lazyAlpacaTradingBroker(),
    marketSymbolProvider: options.dependencies?.marketSymbolProvider,
    notificationSender:
      options.dependencies?.notificationSender ??
      createTradingSmsNotifierFromEnv(),
    supermemoryMirror,
    debateCancelStates,
  };
}

function createLocalApiSupermemoryMirror(): SupermemoryMirror | undefined {
  if (!process.env.SUPERMEMORY_API_KEY) {
    return undefined;
  }

  const warningTimestamps = new Map<string, number>();
  const warningQuietMillis = 5 * 60_000;
  return createSupermemoryMirror({
    memory: createSupermemoryMemoryApi(),
    required: process.env.KAIROS_SUPERMEMORY_REQUIRED === "1",
    onError(error, record) {
      const message = error instanceof Error ? error.message : String(error);
      const isQuotaNoise =
        /(?:^|\s)429(?:\s|$)/.test(message) ||
        /token limit reached|quota|rate limit/i.test(message);
      const warningKey = isQuotaNoise ? "quota" : `${record.scope}.${record.type}`;
      const now = Date.now();
      const lastWarning = warningTimestamps.get(warningKey) ?? 0;
      if (now - lastWarning < warningQuietMillis) {
        return;
      }
      warningTimestamps.set(warningKey, now);
      console.warn(
        `[kairos] Supermemory mirror failed for ${record.scope}.${record.type}: ${message}`,
      );
    },
  });
}

export function createLocalApiHandler(context: LocalApiContext): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? randomUUID();
    return requestLogContext.run(
      {
        requestId,
        startedAt: Date.now(),
        method: request.method,
        path: url.pathname,
      },
      async () => {
        let response: Response;
        try {
          const rateLimitResponse = checkRateLimit(request, url);
          if (rateLimitResponse) {
            response = rateLimitResponse;
          } else {
            const idempotencyFailure = idempotencyKeyFailure(request, url);
            if (idempotencyFailure) {
              response = idempotencyFailure;
            } else {
              const idempotencyKey = idempotencyCacheKey(request, url);
              const cached = idempotencyKey ? readCachedIdempotentResponse(idempotencyKey) : undefined;
              if (cached) {
                response = cached;
              } else {
                response = await handleLocalApiRequest(context, request);
                if (idempotencyKey) {
                  response = await cacheIdempotentResponse(idempotencyKey, response);
                }
              }
            }
          }
        } catch (error) {
          console.error("[kairos] local api uncaught error", {
            requestId,
            method: request.method,
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error),
          });
          response = json({ error: "internal_error", message: "Internal server error." }, 500);
        }
        const secured = withSecurityHeaders(withCors(response, request), request);
        logLocalApiRequest(secured, request, url);
        return secured;
      },
    );
  };
}

function normalizeRequestId(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && /^[a-zA-Z0-9_.:-]{8,128}$/.test(normalized)
    ? normalized
    : undefined;
}

function checkRateLimit(request: Request, url: URL): Response | undefined {
  if (!isRateLimitEnabled() || isHealthOrPreflight(request, url)) return undefined;
  const now = Date.now();
  const windowMs = rateLimitWindowMs();
  const key = rateLimitKey(request);
  const current = rateLimitBuckets.get(key);
  const bucket =
    !current || now - current.windowStartedAt >= windowMs
      ? { windowStartedAt: now, count: 0 }
      : current;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  pruneRateLimitBuckets(now, windowMs);

  const max = rateLimitMaxRequests();
  if (bucket.count <= max) return undefined;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.windowStartedAt + windowMs - now) / 1000),
  );
  return json({
    error: "rate_limited",
    message: "Too many Kairos API requests. Retry after the current rate-limit window.",
    retryAfterSeconds,
  }, 429);
}

function isRateLimitEnabled(): boolean {
  return parseAuthEnabledFlag(process.env.KAIROS_RATE_LIMIT_ENABLED) ?? true;
}

function rateLimitWindowMs(): number {
  const configured = Number(process.env.KAIROS_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_RATE_LIMIT_WINDOW_MS;
}

function rateLimitMaxRequests(): number {
  const configured = Number(process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_RATE_LIMIT_MAX_REQUESTS;
}

function rateLimitKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "local";
  const auth = bearerToken(request.headers.get("authorization"));
  return auth ? `auth:${auth.slice(0, 16)}:${ip}` : `ip:${ip}`;
}

function pruneRateLimitBuckets(now: number, windowMs: number): void {
  if (rateLimitBuckets.size < 1_000) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartedAt >= windowMs) {
      rateLimitBuckets.delete(key);
    }
  }
}

function idempotencyKeyFailure(request: Request, url: URL): Response | undefined {
  if (!requiresIdempotencyKey(request, url)) return undefined;
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
  if (!key) {
    return json({
      error: "idempotency_key_required",
      message: `Missing ${IDEMPOTENCY_KEY_HEADER} header for mutation/job request.`,
    }, 400);
  }
  if (!/^[a-zA-Z0-9_.:-]{8,200}$/.test(key)) {
    return json({
      error: "bad_request",
      message: `${IDEMPOTENCY_KEY_HEADER} must be 8-200 URL-safe characters.`,
    }, 400);
  }
  return undefined;
}

function requiresIdempotencyKey(request: Request, url: URL): boolean {
  if (!isIdempotencyRequired() || isHealthOrPreflight(request, url)) return false;
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return false;
  const segments = url.pathname.split("/").filter(Boolean);
  if (request.method === "POST" && segments[0] === "debates" && segments.length === 1) return true;
  if (
    request.method === "POST" &&
    segments[0] === "branches" &&
    segments.length === 3 &&
    segments[2] === "heartbeat-runs"
  ) return true;
  if (
    request.method === "POST" &&
    segments[0] === "router" &&
    segments[1] === "chats" &&
    segments[3] === "messages"
  ) return true;
  if (request.method === "POST" && segments[0] === "trade-intents") return true;
  if (
    request.method === "POST" &&
    segments[0] === "deep-research" &&
    segments[1] === "chats" &&
    segments[3] === "messages"
  ) return true;
  return false;
}

function isIdempotencyRequired(): boolean {
  return parseAuthEnabledFlag(process.env.KAIROS_REQUIRE_IDEMPOTENCY) ??
    isProductionRuntime();
}

function idempotencyCacheKey(request: Request, url: URL): string | undefined {
  if (!requiresIdempotencyKey(request, url)) return undefined;
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
  return key ? `${request.method}:${url.pathname}:${key}` : undefined;
}

function readCachedIdempotentResponse(key: string): Response | undefined {
  const cached = idempotencyResponses.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    idempotencyResponses.delete(key);
    return undefined;
  }
  const headers = new Headers(cached.headers);
  headers.set("x-idempotency-cache", "hit");
  return new Response(cached.body.slice(0), {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

async function cacheIdempotentResponse(key: string, response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") || response.status >= 500) return response;
  const clone = response.clone();
  const body = await clone.arrayBuffer();
  idempotencyResponses.set(key, {
    expiresAt: Date.now() + IDEMPOTENCY_CACHE_TTL_MS,
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body,
  });
  pruneIdempotencyResponses();
  return response;
}

function pruneIdempotencyResponses(): void {
  const now = Date.now();
  for (const [key, cached] of idempotencyResponses) {
    if (cached.expiresAt <= now) {
      idempotencyResponses.delete(key);
    }
  }
}

function isHealthOrPreflight(request: Request, url: URL): boolean {
  return request.method === "OPTIONS" || url.pathname === "/" || url.pathname === "/health";
}

async function handleLocalApiRequest(
  context: LocalApiContext,
  request: Request,
): Promise<Response> {
    const url = new URL(request.url);
    const authFailure = await authorizeLocalApiRequest(request, url);
    if (authFailure) return authFailure;
    const deepResearchResponse = await handleDeepResearchRequest(context, request);
    if (deepResearchResponse) return deepResearchResponse;
    const route = matchRoute(request.method, url.pathname);

    try {
      if (request.method === "OPTIONS") return empty(204);
      if (!route) return json({ error: "not_found", message: "Route not found." }, 404);

      switch (route.name) {
        case "health":
          return json({ ok: true, service: "kairos-local-api", mode: "local" });

        case "listOpenRouterModels": {
          let models: Awaited<ReturnType<typeof listOpenRouterModels>> = [];
          try {
            models = await listOpenRouterModels({ requireTools: true });
          } catch {
            models = [];
          }
          return json({
            models,
            defaults: openRouterModelDefaults(),
          });
        }

        case "capabilityPreflight":
          return await capabilityPreflight(context, url.searchParams);

        case "listMarketSymbols":
          return await listMarketSymbols(context, url.searchParams);

        case "semanticMarketSymbols":
          return await semanticMarketSymbols(context, await readJson(request));

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

        case "deleteRouterChat": {
          const deleted = await context.store.deleteRouterChat(route.params.chatId);
          return deleted ? empty(204) : json({ error: "not_found", message: "Router chat not found." }, 404);
        }

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

        case "cancelRun":
          return await cancelRun(context, route.params.runId);

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
      if (error instanceof RequestBodyTooLargeError) {
        return json({
          error: "payload_too_large",
          message: error.message,
          maxBytes: error.maxBytes,
        }, 413);
      }
      if (error instanceof SyntaxError) {
        return json({ error: "bad_request", message: "Request body must be valid JSON." }, 400);
      }
      return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unknown error." }, 500);
    }
}

async function authorizeLocalApiRequest(
  request: Request,
  url: URL,
): Promise<Response | undefined> {
  if (request.method === "OPTIONS") return undefined;
  if (url.pathname === "/" || url.pathname === "/health") return undefined;

  if (!isLocalApiAuthEnabled()) {
    return authorizeUnauthenticatedLocalRequest(request);
  }

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return json({ error: "unauthorized", message: "Missing authorization token." }, 401);
  }

  let user: { email?: string };
  try {
    user = await getSupabaseUserForToken(token);
  } catch (error) {
    return json({
      error: "unauthorized",
      message: error instanceof Error ? error.message : "Invalid authorization token.",
    }, 401);
  }
  if (!user.email || !isAllowedKairosEmail(user.email)) {
    return json({ error: "forbidden", message: "Google account is not authorized for Kairos." }, 403);
  }

  return undefined;
}

function authorizeUnauthenticatedLocalRequest(request: Request): Response | undefined {
  const localToken = localApiToken();
  if (localToken) {
    if (request.headers.get(LOCAL_TOKEN_HEADER) === localToken) {
      return undefined;
    }

    return json({
      error: "unauthorized",
      message: `Missing or invalid ${LOCAL_TOKEN_HEADER} header for auth-disabled Kairos API.`,
    }, 401);
  }

  if (request.headers.get(LOCAL_REQUEST_HEADER) === "1") {
    return undefined;
  }

  return json({
    error: "unauthorized",
    message: `Missing ${LOCAL_REQUEST_HEADER}: 1 header for auth-disabled Kairos API.`,
  }, 401);
}

function localApiToken(): string | undefined {
  const token = process.env.KAIROS_LOCAL_API_TOKEN?.trim();
  return token || undefined;
}

async function getSupabaseUserForToken(token: string): Promise<{ email?: string }> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "")
    .replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase auth verification requires SUPABASE_URL and SUPABASE_ANON_KEY.");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Invalid Supabase auth token.");
  }

  const body = await response.json() as { email?: unknown };
  return {
    email: typeof body.email === "string" ? body.email : undefined,
  };
}

function bearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

function isLocalApiAuthEnabled(): boolean {
  return parseAuthEnabledFlag(
    process.env.KAIROS_AUTH_ENABLED ?? process.env.VITE_KAIROS_AUTH_ENABLED,
  ) ?? false;
}

function isAllowedKairosEmail(email: string): boolean {
  return allowedKairosEmails().has(email.trim().toLowerCase());
}

function allowedKairosEmails(): Set<string> {
  const configured = parseEmailList(
    process.env.KAIROS_ALLOWED_EMAILS ?? process.env.VITE_KAIROS_ALLOWED_EMAILS,
  );
  return new Set(
    configured.length > 0
      ? configured
      : [
        "naman.chetwani@gmail.com",
        "sanjay.chetwani@gmail.com",
      ],
  );
}

function parseEmailList(value: unknown): string[] {
  return typeof value === "string"
    ? value
      .split(",")
      .map((candidate) => candidate.trim().toLowerCase().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
    : [];
}

function parseAuthEnabledFlag(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  return undefined;
}

export async function createLocalApi(options: LocalApiOptions = {}): Promise<{ context: LocalApiContext; handler: (request: Request) => Promise<Response> }> {
  const context = await createLocalApiContext(options);
  return { context, handler: createLocalApiHandler(context) };
}

export async function serveLocalApi(options: LocalApiOptions & { port?: number; hostname?: string } = {}) {
  const { handler } = await createLocalApi(options);
  const port = options.port ?? Number(process.env.KAIROS_LOCAL_API_PORT ?? 4321);
  const hostname = options.hostname ?? process.env.KAIROS_LOCAL_API_HOST ?? "127.0.0.1";
  assertLocalApiBindingIsSafe(hostname);

  if ("Bun" in globalThis) {
    const bun = (globalThis as typeof globalThis & { Bun: { serve: (options: {
      port: number;
      hostname: string;
      fetch: (request: Request) => Promise<Response>;
      idleTimeout?: number;
    }) => unknown } }).Bun;
    return bun.serve({ port, hostname, fetch: handler, idleTimeout: 255 });
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

function assertLocalApiBindingIsSafe(hostname: string): void {
  if (isLocalApiAuthEnabled() || isLoopbackHostname(hostname)) {
    return;
  }

  throw new Error(
    [
      `Refusing to bind unauthenticated Kairos API to ${hostname}.`,
      "Enable KAIROS_AUTH_ENABLED=true before exposing the API off localhost.",
    ].join(" "),
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

async function triggerHeartbeat(context: LocalApiContext, branchId: string, body: unknown): Promise<Response> {
  const branch = await context.store.getBranch(branchId);
  if (!branch) return json({ error: "not_found", message: "Branch not found." }, 404);

  const input = heartbeatTriggerSchema.parse(body);
  let completed: RunRecord | undefined;
  try {
    completed = await runHeartbeatForBranch(context, branch, {
      input: input.input,
      metadataSource: "runtime",
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

async function capabilityPreflight(
  context: LocalApiContext,
  searchParams: URLSearchParams,
): Promise<Response> {
  const branchId = searchParams.get("branchId") ?? undefined;
  const branch = branchId ? await context.store.getBranch(branchId) : undefined;
  const checks = buildCapabilityChecks(branch);
  const blocked = checks.filter((check) => check.status === "blocked").length;
  const warnings = checks.filter((check) => check.status === "warning").length;

  return json({
    branchId,
    checkedAt: new Date().toISOString(),
    status: blocked > 0 ? "blocked" : warnings > 0 ? "warning" : "ready",
    checks,
  });
}

function buildCapabilityChecks(branch: BranchRecord | undefined): CapabilityCheck[] {
  const branchConfig = branch?.config;
  const modelOverrides = branchConfigToModelOverrides(branchConfig);
  const heartbeatModel = resolveKairosModelConfig("heartbeat", process.env, modelOverrides).model;
  const heartbeatToolsEnabled = branch
    ? Object.values(heartbeatEnabledTools(branch)).some(Boolean)
    : false;
  const toolCapableHeartbeat = isProbablyOpenRouterToolCapableModel(heartbeatModel);
  const debateRoles: KairosModelRole[] = [
    "debateJudge",
    "debateBull",
    "debateBear",
    "debateFinal",
  ];

  return [
    branch
      ? check("branch", "Selected Branch", "ready", `${branch.name} is selected.`)
      : check("branch", "Selected Branch", "blocked", "No branch is selected."),
    branch?.enabled
      ? check("branch_enabled", "Branch Enabled", "ready", "Branch is enabled.")
      : check("branch_enabled", "Branch Enabled", "warning", "Branch is disabled; manual actions can run, but scheduled monitoring will not."),
    (branch ? branchLawText(branch).trim() : "")
      ? check("law", "Law", "ready", "Branch has law text.")
      : check("law", "Law", "blocked", "Branch needs a law before agent runs are meaningful."),
    (branchConfig?.assets?.length ?? 0) > 0
      ? check("assets", "Tracked Assets", "ready", `${branchConfig?.assets?.join(", ")} configured.`)
      : check("assets", "Tracked Assets", "warning", "No tracked tickers are configured."),
    process.env.OPENROUTER_API_KEY
      ? check("openrouter_key", "OpenRouter Key", "ready", "Model calls are configured.")
      : check("openrouter_key", "OpenRouter Key", "blocked", "OPENROUTER_API_KEY is missing."),
    heartbeatToolsEnabled && !toolCapableHeartbeat
      ? check("heartbeat_model_tools", "Heartbeat Model Tools", "warning", `${heartbeatModel} is not known to support tool calling; heartbeat will run without tools.`)
      : check("heartbeat_model_tools", "Heartbeat Model Tools", "ready", `${heartbeatModel} is compatible with the current heartbeat tool mode.`),
    ...debateRoles.map((role) => {
      const model = resolveKairosModelConfig(role, process.env, modelOverrides).model;
      return check(`${role}_model`, humanizeRole(role), "ready", model);
    }),
    process.env.EXA_API_KEY
      ? check("exa_key", "Exa Key", "ready", "Current web/news research is available.")
      : check("exa_key", "Exa Key", "warning", "EXA_API_KEY is missing; Exa tools will be disabled."),
    process.env.SUPERMEMORY_API_KEY
      ? check("supermemory_key", "Supermemory Key", "ready", "Agent memory mirroring and retrieval are available.")
      : check("supermemory_key", "Supermemory Key", "warning", "SUPERMEMORY_API_KEY is missing; agent memory is local-only."),
    process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY
      ? check("alpaca_keys", "Alpaca Keys", "ready", "Market snapshots and paper trading can use Alpaca.")
      : check("alpaca_keys", "Alpaca Keys", "warning", "Alpaca credentials are incomplete; portfolio/market snapshot paths may use fallback or fail."),
    process.env.FINNHUB_API_KEY
      ? check("finnhub_key", "Finnhub Key", "ready", "Company news and Finnhub information tools are available.")
      : check("finnhub_key", "Finnhub Key", "warning", "FINNHUB_API_KEY is missing; Finnhub tools will be disabled."),
  ];
}

function check(
  id: string,
  label: string,
  status: CapabilityCheck["status"],
  detail: string,
): CapabilityCheck {
  return { id, label, status, detail };
}

function humanizeRole(role: KairosModelRole): string {
  return role.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

async function runHeartbeatForBranch(
  context: LocalApiContext,
  branch: BranchRecord,
  options: {
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
    input: runPayload,
    metadata: { source: options.metadataSource },
  });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
  });

  let result: HeartbeatRunResult;
  try {
    result = await context.runHeartbeat({
      branchId: branch.id,
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
  const latest = await context.store.getRun(run.id);
  if (latest?.status === "canceled") {
    return latest;
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
        title: "Trade blocked",
        body: "The debate crossed the trading threshold, but this branch has no configured asset symbol.",
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
        title: `${symbol} sell blocked`,
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
    const requestedQty = decision.sizing?.qty;
    const requestedNotional = decision.sizing?.notional;
    const requestedOrderType = resolveDecisionOrderType(decision.sizing, tradingConfig);
    const requestedLimitPrice =
      requestedOrderType === "limit"
        ? normalizeLimitPriceForSide(tradeSide, decision.sizing?.limitPrice)
        : undefined;
    if (requestedOrderType === "limit" && requestedLimitPrice === undefined) {
      await context.store.createMessage({
        type: "paper_order_blocked",
        severity: "warning",
        title: `${symbol} limit order blocked`,
        body: "The debate selected or branch config required a limit order, but the final decision did not include a valid limit price.",
        branchId: branch?.id,
        lawId: branch?.lawId,
        sourceRunId: run.id,
        confidence: decision.confidence,
        metadata: {
          thresholdPolicy: policy,
          action: decision.action,
          judgeSizing: decision.sizing,
          portfolioContext: compactPortfolioContext(portfolioSnapshot),
        },
      });
      return;
    }
    const maxOrderNotional = tradingConfig.maxNotionalPerOrder ?? tradingConfig.maxNotionalUsd;
    const cappedNotional =
      requestedNotional !== undefined && maxOrderNotional !== undefined
        ? Math.min(requestedNotional, maxOrderNotional)
        : requestedNotional;
    const cappedQty =
      tradeSide === "sell" && requestedQty !== undefined && currentPosition?.qty !== undefined
        ? Math.min(requestedQty, currentPosition.qty)
        : requestedQty;
    const intentQty =
      cappedQty ??
      (tradeSide === "sell" && cappedNotional === undefined
        ? currentPosition?.qty
        : undefined);
    const intentNotional =
      cappedNotional ??
      (tradeSide === "buy" && cappedQty === undefined ? defaultNotional : undefined);
    const sizingGuardrailNotes = [
      requestedNotional !== undefined &&
      cappedNotional !== undefined &&
      cappedNotional < requestedNotional
        ? `Judge notional ${requestedNotional} was capped to max per trade ${cappedNotional}.`
        : undefined,
      requestedQty !== undefined &&
      cappedQty !== undefined &&
      cappedQty < requestedQty
        ? `Judge sell quantity ${requestedQty} was capped to held quantity ${cappedQty}.`
        : undefined,
    ].filter(Boolean);
    intent = await context.store.createTradeIntent({
      branchId: branch?.id,
      lawId: branch?.lawId,
      sourceRunId: run.id,
      symbol,
      side: tradeSide,
      qty: intentQty,
      notional: intentNotional,
      orderType: requestedOrderType,
      timeInForce: tradingConfig.defaultTimeInForce ?? "day",
      limitPrice: requestedLimitPrice,
      confidence: decision.confidence,
      evidence: decision.citations,
      reasoning: decision.summary,
      expectedCatalyst: decision.summary,
      risk: "Generated from a debate threshold crossing; review source quality, volatility, and position exposure.",
      timeHorizon: "Branch-defined event horizon.",
      positionSizingRationale:
        [
          decision.sizing?.rationale ??
          (tradeSide === "buy"
            ? `Judge omitted sizing; uses configured max order notional ${defaultNotional}.`
            : `Judge omitted sizing; uses cached ${symbol} position quantity ${currentPosition?.qty}.`),
          ...sizingGuardrailNotes,
        ].join(" "),
      invalidationCondition: "Evidence is stale, contradicted, immaterial, or already priced in.",
      exitCondition: "Manual review or future branch-specific exit law.",
      approvalsRequired:
        policy.permittedAction === "paper_order" ? [] : ["paper_auto_trade_disabled"],
      status: policy.permittedAction === "paper_order" ? "paper_ready" : "draft",
      tradingConfig,
      metadata: {
          thresholdPolicy: policy,
          action: decision.action,
          judgeSizing: decision.sizing,
          normalizedOrderType: requestedOrderType,
          normalizedLimitPrice: requestedLimitPrice,
          autoTradeEnabled: policy.autoTradeEnabled,
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
        : `${tradeSide.toUpperCase()} signal crossed trading threshold`,
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
  const sourceRunId = firstNonEmptyString(
    readString(payload.sourceRunId),
    readString(escalation?.sourceRunId),
    readString(escalation?.runId),
  );
  const branchId =
    typeof payload.branchId === "string"
      ? payload.branchId
      : typeof escalation?.branchId === "string"
        ? escalation.branchId
        : undefined;
  const branch = branchId ? await context.store.getBranch(branchId) : undefined;
  const [portfolioSnapshot, tradeIntents, brokerOrders] = await Promise.all([
    context.store.latestPortfolioSnapshot(),
    context.store.listTradeIntents(),
    context.store.listBrokerOrders(),
  ]);
  const portfolioContext = compactPortfolioContext(portfolioSnapshot, {
    brokerOrders,
    tradeIntents,
  });
  const humanInterjections = mergeHumanInterjections(
    readHumanInterjections(payload.humanInterjections),
    sourceRunId
      ? await loadRunAndAncestorHumanInterjections(context, sourceRunId)
      : [],
  );
  const runPayload = {
    ...payload,
    ...(sourceRunId ? { sourceRunId } : {}),
    ...(portfolioContext ? { portfolioContext } : {}),
    ...(branch ? { branch: branchRunContext(branch) } : {}),
    ...(humanInterjections.length > 0 ? { humanInterjections } : {}),
  };
  const run = await context.store.createRun({
    kind: "debate",
    status: "running",
    branchId,
    input: runPayload,
    metadata: {
      source: "runtime",
      ...(sourceRunId ? { parentRunId: sourceRunId } : {}),
    },
  });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
    payload: { kind: "debate" },
  });
  const debateCancelState: DebateCancelState = { canceled: false };
  context.debateCancelStates.set(run.id, debateCancelState);

  if (input.async) {
    void executeDebateRun(
      context,
      run,
      runPayload,
      branch,
      debateCancelState,
    ).catch((error) => {
      console.error("[kairos] background debate failed", error);
    });
    return json({ run }, 202);
  }

  const completed = await executeDebateRun(
    context,
    run,
    runPayload,
    branch,
    debateCancelState,
  );
  if (completed.status === "failed") {
    return json({
      run: completed,
      error: "run_failed",
      message: readString(completed.output?.error) ?? "Debate failed.",
    }, 500);
  }

  return json({ run: completed }, 201);
}

async function executeDebateRun(
  context: LocalApiContext,
  run: RunRecord,
  runPayload: JsonRecord,
  branch: BranchRecord | undefined,
  cancelState?: DebateCancelState,
): Promise<RunRecord> {
  const onProgress = async (event: AppendRunEventInput): Promise<void> => {
    if (!await isDebateActive(context, run.id, cancelState)) {
      return;
    }
    await context.store.appendRunEvent(run.id, event);
  };
  let result: DebateCreateResult;
  try {
    const timeoutMs = debateTimeoutMs(branch?.config);
    result = await withTimeout(
      context.createDebate({
        payload: runPayload,
        branch,
        deepResearchContext: context,
        context,
        runId: run.id,
        isCanceled: () => cancelState?.canceled ?? false,
        onProgress,
      }),
      timeoutMs,
      `Debate workflow timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    );
  } catch (error) {
    context.debateCancelStates.delete(run.id);
    if (await isDebateCanceled(context, run.id, cancelState)) {
      return (await context.store.getRun(run.id)) ?? run;
    }
    const message = error instanceof Error ? error.message : "Unknown error.";
    const interrupted = message.toLowerCase().includes("timed out");
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: message, interrupted },
    });
    await context.store.appendRunEvent(run.id, {
      type: "debate.failed",
      payload: { error: message, interrupted },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: message, interrupted },
    });
    return failed ?? { ...run, status: "failed", output: { error: message, interrupted } };
  }

  if (await isDebateCanceled(context, run.id, cancelState)) {
    context.debateCancelStates.delete(run.id);
    return (await context.store.getRun(run.id)) ?? run;
  }
  for (const event of result.events ?? []) {
    await onProgress(event);
  }
  if (await isDebateCanceled(context, run.id, cancelState)) {
    context.debateCancelStates.delete(run.id);
    return (await context.store.getRun(run.id)) ?? run;
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  context.debateCancelStates.delete(run.id);
  if (completed) {
    await applyTradingPolicyToDebate(context, completed, branch);
  }
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return completed ?? run;
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

async function cancelRun(context: LocalApiContext, runId: string): Promise<Response> {
  const run = await context.store.getRun(runId);
  if (!run) return json({ error: "not_found", message: "Run not found." }, 404);
  if (run.status !== "running" && run.status !== "pending") {
    return json({
      run,
      canceled: false,
      message: "Only pending or running runs can be canceled.",
    }, 409);
  }

  const cancelState = context.debateCancelStates.get(runId) ??
    context.debateCancelStates.set(runId, { canceled: false }).get(runId);
  if (cancelState) {
    cancelState.canceled = true;
  }
  const canceled = await context.store.updateRun(runId, {
    status: "canceled",
    output: {
      ...(run.output ?? {}),
      canceled: true,
      error: "Run canceled by user.",
    },
  });
  await context.store.appendRunEvent(runId, {
    type: "run.canceled",
    payload: { reason: "user_requested" },
  });

  return json({ run: canceled, canceled: true });
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
  const chatTitle = chat.title
    ? undefined
    : await generateRouterChatTitle(input.text.trim(), input.attachments);

  const userMessage = await context.store.createRouterMessage({
    chatId,
    role: "user",
    text: input.text.trim() || undefined,
    chatTitle,
    attachments: input.attachments,
  });
  const run = await context.store.createRun({
    kind: "router",
    status: "running",
    input: {
      chatId,
      messageId: userMessage.id,
      text: userMessage.text,
      attachments: userMessage.attachments ?? [],
    },
  });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
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

    const heartbeatResults = await Promise.all(
      selectedBranchIds.map(async (branchId) => {
        const branch = branches.find((item) => item.id === branchId);
        if (!branch) {
          return {
            branchId,
            error: "Branch was selected by the router but no longer exists.",
          };
        }

        try {
          const heartbeatRun = await runHeartbeatForBranch(context, branch, {
            input: {
              origin: "router",
              sourceRunId: run.id,
              messageText: userMessage.text,
              sources,
              promptModifier:
                "This run was triggered by human-routed information. Evaluate only whether this information is relevant, novel, and potentially escalation-worthy for this branch's law. Do not trade. Do not assume the human is correct.",
            },
            metadataSource: "router",
          });
          return { branchId, heartbeatRun };
        } catch (error) {
          return {
            branchId,
            failedRun: getFailedRunFromError(error),
            error: error instanceof Error ? error.message : "Unknown error.",
          };
        }
      }),
    );
    const heartbeatRuns = heartbeatResults
      .map((result) => result.heartbeatRun)
      .filter((heartbeatRun): heartbeatRun is RunRecord => Boolean(heartbeatRun));
    const heartbeatAttemptRuns = heartbeatResults
      .flatMap((result) => [result.heartbeatRun, result.failedRun])
      .filter((heartbeatRun): heartbeatRun is RunRecord => Boolean(heartbeatRun));
    const heartbeatFailures = heartbeatResults
      .filter((result) => result.error)
      .map((result) => ({
        branchId: result.branchId,
        runId: result.failedRun?.id,
        run: result.failedRun,
        error: result.error,
      }));

    for (const result of heartbeatResults) {
      const heartbeatToolCall = createRouterToolCall({
        name: "heartbeat_wakeup",
        status: result.error ? "failed" : "succeeded",
        summary: result.error
          ? `Failed to wake ${result.branchId}: ${result.error}`
          : `Woke ${result.branchId} for heartbeat evaluation with router-origin context.`,
        input: { branchId: result.branchId },
        output: result.heartbeatRun
          ? { runId: result.heartbeatRun.id, status: result.heartbeatRun.status }
          : result.failedRun
            ? { runId: result.failedRun.id, status: result.failedRun.status }
            : undefined,
        error: result.error,
      });
      toolCalls.push(heartbeatToolCall);
      await context.store.appendRunEvent(run.id, {
        type: result.error ? "router.heartbeat_failed" : "router.heartbeat_triggered",
        payload: {
          branchId: result.branchId,
          runId: result.heartbeatRun?.id ?? result.failedRun?.id,
          error: result.error,
          toolCall: heartbeatToolCall,
        },
      });
    }

    const output = {
      branchIds: selectedBranchIds,
      heartbeatRunIds: heartbeatRuns.map((heartbeatRun) => heartbeatRun.id),
      heartbeatFailures,
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
      chat: await context.store.getRouterChat(chatId),
      userMessage,
      assistantMessage,
      run: completed,
      heartbeatRuns,
      heartbeatAttemptRuns,
      heartbeatFailures,
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

async function generateRouterChatTitle(
  text: string,
  attachments: RouterAttachmentRecord[],
): Promise<string | undefined> {
  if (!text.trim() && attachments.length === 0) return undefined;

  try {
    const model = process.env.KAIROS_NOTIFICATION_MODEL ?? "google/gemma-4-31b-it";
    const title = await callGemmaChatTitleModel(text, model);
    return title ?? buildRouterChatTitle({ text, attachments });
  } catch {
    return buildRouterChatTitle({ text, attachments });
  }
}

async function callGemmaChatTitleModel(
  text: string,
  model: string,
): Promise<string | undefined> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !text.trim()) return undefined;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: "system",
          content: "Name this chat. Return 2-5 plain words. No quotes. No punctuation.",
        },
        {
          role: "user",
          content: text.slice(0, 1200),
        },
      ],
    }),
  });

  if (!response.ok) return undefined;

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return cleanRouterChatTitle(payload.choices?.[0]?.message?.content);
}

function cleanRouterChatTitle(value: string | undefined): string | undefined {
  const title = value
    ?.replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return undefined;
  return title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title;
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
  broker: TradingBroker,
): Promise<void> {
  if (!broker.listPaperOrders) {
    return;
  }

  const orders = await broker.listPaperOrders({ status: "all", limit: 100 });
  await Promise.all(orders.map((order: Parameters<KairosLocalStore["createBrokerOrder"]>[0]) => context.store.createBrokerOrder(order)));
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
    scope: "trading_audit",
    detail:
      "Kairos stores trade intents, submitted broker orders, trading messages, and portfolio snapshots in the configured runtime store.",
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
    title: `${input.symbol} trade candidate`,
    body: policy.autoTradeEnabled
      ? "Confidence crossed the trading threshold. Auto-submit is enabled; preflight will run before submission."
      : "Confidence crossed the trading threshold. Auto-submit is disabled, so this is recorded as a trade intent only.",
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

  if (!policy.autoTradeEnabled) {
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

  const result = await submitOrder(getTradingBroker(context), tradeIntent, resolvedTradingConfig);
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
      title: `${tradeIntent.symbol} order blocked`,
      body: result.preflight.reasons.join(" "),
      branchId: tradeIntent.branchId,
      lawId: tradeIntent.lawId,
      sourceRunId: tradeIntent.sourceRunId,
      tradeIntentId: tradeIntent.id,
      confidence: tradeIntent.confidence,
      metadata: { preflight: result.preflight },
    });
    if (tradeIntent.sourceRunId) {
      await context.store.appendRunEvent(tradeIntent.sourceRunId, {
        type: "trading.intent.failed",
        payload: {
          tradeIntentId: tradeIntent.id,
          preflight: result.preflight,
          messageId: message.id,
        },
      });
    }
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
    title: `${tradeIntent.symbol} order submitted`,
    body: `Submitted ${tradeIntent.side} ${tradeIntent.orderType} order to Alpaca.`,
    branchId: tradeIntent.branchId,
    lawId: tradeIntent.lawId,
    sourceRunId: tradeIntent.sourceRunId,
    tradeIntentId: tradeIntent.id,
    brokerOrderId: brokerOrder.id,
    confidence: tradeIntent.confidence,
    metadata: { preflight: result.preflight },
  });
  if (tradeIntent.sourceRunId) {
    await context.store.appendRunEvent(tradeIntent.sourceRunId, {
      type: "trading.intent.submitted",
      payload: {
        tradeIntentId: tradeIntent.id,
        brokerOrderId: brokerOrder.id,
        messageId: message.id,
      },
    });
  }

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

function getTradingBroker(context: LocalApiContext): TradingBroker {
  context.tradingBroker ??= lazyAlpacaTradingBroker();
  return context.tradingBroker;
}

function lazyAlpacaTradingBroker(): TradingBroker {
  let broker: TradingBroker | undefined;
  const current = () => {
    broker ??= createAlpacaTradingBroker();
    return broker;
  };

  return {
    getPortfolioSnapshot: () => current().getPortfolioSnapshot(),
    getClock: () => current().getClock(),
    getAsset: (symbol) => current().getAsset(symbol),
    listPaperOrders: (input) => current().listPaperOrders?.(input) ?? Promise.resolve([]),
    submitPaperOrder: (input) => current().submitPaperOrder(input),
  };
}

async function listMarketSymbols(
  context: LocalApiContext,
  params: URLSearchParams,
): Promise<Response> {
  const query = params.get("query") ?? undefined;
  const limit = parsePositiveInteger(params.get("limit")) ?? 500;

  try {
    const symbols = await withTimeout(
      getMarketSymbolProvider(context).listMarketSymbols({
        query,
        limit,
      }),
      15000,
      "Market symbol directory provider timed out.",
    );
    return json({
      symbols,
      count: symbols.length,
      source: "alpaca_assets",
      cacheTags: marketSymbolCacheTags(query),
    });
  } catch (error) {
    return json({
      symbols: [],
      count: 0,
      source: "unavailable",
      cacheTags: marketSymbolCacheTags(query),
      error: error instanceof Error ? error.message : "Unable to load market symbols.",
    });
  }
}

async function semanticMarketSymbols(
  context: LocalApiContext,
  body: unknown,
): Promise<Response> {
  const input = semanticSymbolSearchSchema.parse(body);
  const provider = getMarketSymbolProvider(context);

  try {
    const symbols = await withTimeout(
      semanticSymbolSearch(provider, input.query, input.limit),
      15000,
      "Semantic market symbol lookup timed out.",
    );

    return json({
      symbols,
      count: symbols.length,
      source: "semantic_symbol_search",
      cacheTags: [
        "market-symbols",
        `market-symbols:semantic:${input.query.trim().toUpperCase()}`,
      ],
    });
  } catch (error) {
    return json({
      symbols: [],
      count: 0,
      source: "unavailable",
      cacheTags: ["market-symbols"],
      error: error instanceof Error ? error.message : "Unable to search market symbols semantically.",
    });
  }
}

async function semanticSymbolSearch(
  provider: MarketSymbolProvider,
  query: string,
  limit: number,
): Promise<AlpacaMarketSymbol[]> {
  const terms = semanticSymbolTerms(query);
  const curatedSymbols = semanticCuratedSymbols(terms);
  const curatedCandidates =
    provider.getMarketSymbols && curatedSymbols.length > 0
      ? await provider.getMarketSymbols(curatedSymbols).catch(() => [])
      : [];
  const curatedResults = rankSemanticSymbols(
    curatedCandidates,
    terms,
    curatedSymbols,
    limit,
  );
  if (curatedResults.length >= Math.min(limit, 8)) {
    return curatedResults;
  }

  const lookupTerms = semanticLookupTerms(terms);
  const candidateGroups = await Promise.all(
    lookupTerms.map((term) =>
      provider.listMarketSymbols({ query: term, limit: 40 }).catch(() => []),
    ),
  );
  const candidates = mergeMarketSymbols([curatedCandidates, ...candidateGroups].flat());

  return rankSemanticSymbols(candidates, terms, curatedSymbols, limit);
}

function rankSemanticSymbols(
  candidates: AlpacaMarketSymbol[],
  terms: string[],
  curatedSymbols: string[],
  limit: number,
): AlpacaMarketSymbol[] {
  return mergeMarketSymbols(candidates)
    .map((symbol) => ({
      symbol,
      score: semanticSymbolScore(symbol, terms, curatedSymbols),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.symbol.symbol.localeCompare(right.symbol.symbol),
    )
    .slice(0, limit)
    .map((item) => item.symbol);
}

function semanticLookupTerms(terms: string[]): string[] {
  return terms
    .filter((term) => !broadSemanticTerms.has(term))
    .slice(0, 4);
}

function semanticSymbolTerms(query: string): string[] {
  const rawTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9.\-\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !semanticStopWords.has(token));
  const terms = new Set(rawTokens);

  for (const token of rawTokens) {
    for (const term of semanticExpansions[token] ?? []) terms.add(term);
    if (token.startsWith("infra") || token.startsWith("infer")) {
      ["infrastructure", "data center", "server", "networking"].forEach((term) =>
        terms.add(term),
      );
    }
  }

  if (terms.has("tech") || terms.has("technology")) {
    ["software", "cloud", "semiconductor", "chip", "data center"].forEach((term) =>
      terms.add(term),
    );
  }

  return [...terms].slice(0, 24);
}

function semanticCuratedSymbols(terms: string[]): string[] {
  const termSet = new Set(terms);
  return Object.entries(symbolSemanticTags)
    .filter(([, tags]) => tags.some((tag) => termSet.has(tag)))
    .map(([symbol]) => symbol);
}

function semanticSymbolScore(
  symbol: AlpacaMarketSymbol,
  terms: string[],
  curatedSymbols: string[],
): number {
  const text = [
    symbol.symbol,
    symbol.name,
    symbol.exchange,
    symbol.assetClass,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tags = symbolSemanticTags[symbol.symbol.toUpperCase()] ?? [];
  const curated = new Set(curatedSymbols);

  let score = curated.has(symbol.symbol.toUpperCase()) ? 25 : 0;
  for (const term of terms) {
    if (symbol.symbol.toLowerCase() === term && !broadSemanticTerms.has(term)) {
      score += 100;
    }
    if (text.includes(term)) score += term.length <= 3 ? 3 : 8;
    if (tags.includes(term)) score += 16;
  }

  return score;
}

function mergeMarketSymbols(symbols: AlpacaMarketSymbol[]): AlpacaMarketSymbol[] {
  const records = new Map<string, AlpacaMarketSymbol>();
  for (const symbol of symbols) {
    const key = symbol.symbol.trim().toUpperCase();
    if (key && !records.has(key)) records.set(key, { ...symbol, symbol: key });
  }
  return [...records.values()];
}

const semanticStopWords = new Set([
  "all",
  "and",
  "are",
  "for",
  "give",
  "me",
  "of",
  "obvious",
  "ones",
  "related",
  "the",
  "to",
]);

const semanticExpansions: Record<string, string[]> = {
  ai: ["artificial intelligence", "semiconductor", "chip", "data center", "cloud"],
  chip: ["semiconductor", "gpu", "processor"],
  chips: ["semiconductor", "gpu", "processor"],
  cloud: ["data center", "software", "infrastructure"],
  defense: ["aerospace", "government", "security"],
  fintech: ["payments", "bank", "financial"],
  gpu: ["semiconductor", "chip", "data center"],
  infra: ["infrastructure", "data center", "server", "networking"],
  infrastructure: ["data center", "server", "networking"],
  tech: ["technology", "software", "semiconductor", "cloud"],
};

const broadSemanticTerms = new Set([
  "ai",
  "chip",
  "chips",
  "cloud",
  "defense",
  "fintech",
  "gpu",
  "infra",
  "infrastructure",
  "tech",
  "technology",
]);

const symbolSemanticTags: Record<string, string[]> = {
  AAPL: ["tech", "technology", "consumer", "hardware"],
  AMD: ["tech", "technology", "semiconductor", "chip", "gpu", "ai"],
  AMZN: ["tech", "technology", "cloud", "ai", "infrastructure"],
  ANET: ["tech", "technology", "networking", "data center", "infrastructure"],
  ASML: ["tech", "technology", "semiconductor", "chip"],
  AVGO: ["tech", "technology", "semiconductor", "chip", "networking", "ai"],
  DELL: ["tech", "technology", "server", "data center", "infrastructure"],
  GOOGL: ["tech", "technology", "cloud", "ai"],
  HPE: ["tech", "technology", "server", "networking", "infrastructure"],
  META: ["tech", "technology", "ai", "data center"],
  MSFT: ["tech", "technology", "cloud", "ai", "software"],
  MU: ["tech", "technology", "semiconductor", "memory", "ai"],
  NVDA: ["tech", "technology", "semiconductor", "chip", "gpu", "ai", "data center"],
  ORCL: ["tech", "technology", "cloud", "software", "database"],
  PLTR: ["tech", "technology", "ai", "software", "defense", "government"],
  SMCI: ["tech", "technology", "server", "data center", "infrastructure", "ai"],
  TSM: ["tech", "technology", "semiconductor", "chip"],
};

function marketSymbolCacheTags(query: string | undefined): string[] {
  return [
    "market-symbols",
    query?.trim()
      ? `market-symbols:query:${query.trim().toUpperCase()}`
      : "market-symbols:starter",
  ];
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function isDebateCanceled(
  context: LocalApiContext,
  runId: string,
  cancelState?: DebateCancelState,
): Promise<boolean> {
  if (cancelState?.canceled) {
    return true;
  }

  const run = await context.store.getRun(runId);
  return run?.status === "canceled";
}

async function isDebateActive(
  context: LocalApiContext,
  runId: string,
  cancelState?: DebateCancelState,
): Promise<boolean> {
  if (cancelState?.canceled) {
    return false;
  }

  const run = await context.store.getRun(runId);
  return run?.status === "running";
}

function debateTimeoutMs(config?: KairosBranchAgentConfig): number {
  const configuredMinutes = config?.budgets?.debateTimeoutMinutes;
  if (
    typeof configuredMinutes === "number" &&
    Number.isFinite(configuredMinutes) &&
    configuredMinutes > 0
  ) {
    return Math.round(configuredMinutes * 60_000);
  }

  const configured = Number(process.env.KAIROS_DEBATE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 300_000;
}

function getMarketSymbolProvider(context: LocalApiContext): MarketSymbolProvider {
  context.marketSymbolProvider ??= lazyMarketSymbolProvider();
  return context.marketSymbolProvider;
}

function lazyMarketSymbolProvider(): MarketSymbolProvider {
  return createAlpacaTradingClient();
}

async function runConfiguredHeartbeat(input: HeartbeatTriggerInput): Promise<HeartbeatRunResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required to run the heartbeat agent.");
  }

  const branchConfig = toHeartbeatBranchConfig(input.branch);
  const modelOverrides = branchConfigToModelOverrides(input.branch.config);
  const memory = process.env.SUPERMEMORY_API_KEY
    ? createSupermemoryMemoryApi()
    : undefined;
  const exa = process.env.EXA_API_KEY ? new ExaApi() : undefined;
  const finnhub = process.env.FINNHUB_API_KEY ? new FinnhubApi() : undefined;
  const alpaca = process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY
    ? createAlpacaTradingClient()
    : undefined;
  const resolvedHeartbeatModel = branchConfig.heartbeat.model;
  const toolCapableModel = isProbablyOpenRouterToolCapableModel(resolvedHeartbeatModel);
  const enabledTools = heartbeatEnabledTools(input.branch);
  const tools = toolCapableModel
    ? createHeartbeatTools({
        exa,
        memory,
        supermemory: memory,
      })
    : undefined;
  const result = await runHeartbeatOnce(branchConfig, {
    model: createOpenRouterAiSdkModelForRole("heartbeat", { modelOverrides }),
    prompts: {
      systemPrompt: input.branch.config?.prompts?.heartbeatSystemPrompt,
    },
    enabledTools,
    seedProviders: createHeartbeatSeedProviders({
      alpaca,
      finnhub,
      memory,
      supermemory: memory,
    }),
    tools,
    maxToolSteps: toolCapableModel
      ? input.branch.config?.heartbeat?.maxToolSteps ?? 3
      : 0,
    runId: readString(input.payload.runId),
    seedPolicy: { allowPartialSeedBundle: true },
  });

  return {
    output: {
      ...result.output,
      escalationEvent: result.escalationEvent,
    },
    events: [
      {
        type: "heartbeat.seeded",
        payload: result.seedBundle as unknown as JsonRecord,
      },
      {
        type: "heartbeat.decision",
        payload: result.output as unknown as JsonRecord,
      },
      ...result.toolTraces.map((trace) => ({
        type: trace.error ? "heartbeat.tool.failed" : "heartbeat.tool.completed",
        payload: trace as unknown as JsonRecord,
      })),
    ],
  };
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

  const branches = await Promise.all(
    input.branchIds.map((branchId) => context.store.getBranch(branchId)),
  );
  const containerTags = input.branchIds.flatMap((branchId, index) => {
    const branch = branches[index];
    return branch
      ? branchSupermemoryContainerTags(branch)
      : [
        getMemoryContainerTag({ scopeId: branchId, prefix: "branch" }),
        getMemoryContainerTag({ scopeId: branchId, prefix: "branch_profile" }),
      ];
  });

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
      });
      sources.push(...webpageSources);
      const toolCall = createRouterToolCall({
        name: "exa_contents",
        status: "succeeded",
        summary: `Retrieved ${webpageSources.length} webpage source${webpageSources.length === 1 ? "" : "s"} through Exa contents.`,
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
  if (!process.env.EXA_API_KEY) {
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

function extractCitationsFromDeepResearchToolCalls(
  toolCalls: RouterToolCallRecord[],
): Array<{ title?: string; url: string; source?: string }> {
  const citations: Array<{ title?: string; url: string; source?: string }> = [];
  const seen = new Set<string>();

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") return;
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (url && !seen.has(url)) {
      citations.push({
        title: typeof record.title === "string" ? record.title : undefined,
        url,
        source: typeof record.source === "string" ? record.source : undefined,
      });
      seen.add(url);
    }

    const citationsValue = record.citations;
    const resultsValue = record.results;
    if (Array.isArray(citationsValue)) citationsValue.forEach(visit);
    if (Array.isArray(resultsValue)) resultsValue.forEach(visit);
    if (record.output !== undefined) visit(record.output);
    if (record.input !== undefined) visit(record.input);
  };

  for (const toolCall of toolCalls) {
    if (toolCall.output) visit(toolCall.output);
  }

  return citations;
}

async function runConfiguredDebate(input: DebateCreateInput): Promise<DebateCreateResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is required to run the debate agent.",
    );
  }

  const config = createLocalDebateRunConfig(input);
  await input.onProgress?.({
    type: "debate.created",
    payload: { debateId: config.debateId, payload: input.payload },
  });
  await input.onProgress?.({
    type: "debate.started",
    payload: { debateId: config.debateId },
  });
  const branchConfig = input.branch?.config;
  const modelOverrides = branchConfigToModelOverrides(branchConfig);
  const debateConfig = resolveDebateAgentConfig(branchConfig);
  const informationConfig = resolveInformationAgentConfig(branchConfig);
  const memory = process.env.SUPERMEMORY_API_KEY
    ? createSupermemoryMemoryApi()
    : undefined;
  const exa = process.env.EXA_API_KEY ? new ExaApi() : undefined;
  const finnhub = process.env.FINNHUB_API_KEY ? new FinnhubApi() : undefined;
  const globalTools = createGlobalToolRegistry({
    exa,
    finnhub,
    memory,
    memoryContainerTag: input.branch
      ? branchProfileMemoryContainerTag(input.branch)
      : undefined,
    finnhubPremiumAccess: informationConfig.finnhubPremiumAccess,
    deepResearch: async (toolInput) => {
      if (!input.deepResearchContext) {
        throw new Error("Deep Research context is required for debate research tools.");
      }
      const result = await runDeepResearchQuery(input.deepResearchContext, {
        text: toolInput,
      });
      return {
        summary: result.text,
        citations: extractCitationsFromDeepResearchToolCalls(result.toolCalls),
        raw: {
          text: result.text,
          reasoning: result.reasoning,
          model: result.model,
          reasoningEffort: result.reasoningEffort,
          toolCalls: result.toolCalls,
        },
      };
    },
  });
  const informationModels = {
    plannerModel: structuredModelProvider(createOpenRouterChatModelForRole("informationPlanner", {
      modelOverrides,
    })),
    synthesisModel: structuredModelProvider(createOpenRouterChatModelForRole("informationSynthesis", {
      modelOverrides,
    })),
  };
  const result = await runDebateAgent(config, {
    models: {
      judge: structuredModelProvider(createOpenRouterChatModelForRole("debateJudge", { modelOverrides })),
      bull: structuredModelProvider(createOpenRouterChatModelForRole("debateBull", { modelOverrides })),
      bear: structuredModelProvider(createOpenRouterChatModelForRole("debateBear", { modelOverrides })),
      final: structuredModelProvider(createOpenRouterChatModelForRole("debateFinal", { modelOverrides })),
    },
    prompts: debateConfig.prompts,
    enabledTools: {
      exa_search: Boolean(exa),
      exa_research: Boolean(exa),
      ...debateConfig.enabledTools,
    },
    globalTools,
    observer: createDebateProgressObserver(input.onProgress),
    isCanceled: input.isCanceled,
    loadHumanInterjections: () =>
      input.context && input.runId ? loadRunHumanInterjections(input.context, input.runId) : [],
    tools: createInformationDebateTools({
      ...informationModels,
      exa,
      finnhub,
      memory,
      supermemory: memory,
      supermemoryContainerTag: input.branch
        ? branchProfileMemoryContainerTag(input.branch)
        : undefined,
      maxToolCalls: informationConfig.maxToolCalls,
      enabledTools: informationConfig.enabledTools,
      finnhubPremiumAccess: informationConfig.finnhubPremiumAccess,
    }),
  });

  return {
    output: debateResultOutput(result),
    events: debateResultEvents(result, input.payload, { includeStart: false }),
  };
}

function createDebateProgressObserver(
  onProgress: DebateCreateInput["onProgress"],
) {
  if (!onProgress) return undefined;

  return {
    event: async (event: {
      type: string;
      timestamp: string;
      payload?: unknown;
    }) => {
      for (const progressEvent of debateProgressEventsFromObservation(event)) {
        await onProgress(progressEvent);
      }
    },
  };
}

function debateProgressEventsFromObservation(event: {
  type: string;
  timestamp: string;
  payload?: unknown;
}): AppendRunEventInput[] {
  const payload = isJsonRecord(event.payload) ? event.payload : {};
  const timestamp = event.timestamp;

  if (event.type === "judge_start") {
    return [
      { type: "judge.plan.started", timestamp, payload },
      { type: "model.call.started", timestamp, payload: { ...payload, role: "judge" } },
    ];
  }

  if (event.type === "bull_start" || event.type === "bear_start") {
    const role = event.type.replace("_start", "");
    return [
      { type: "model.call.started", timestamp, payload: { ...payload, role } },
    ];
  }

  if (event.type === "bull_complete" || event.type === "bear_complete") {
    const role = event.type.replace("_complete", "");
    return [
      { type: "participant.responded", timestamp, payload: { ...payload, role } },
      { type: "model.call.completed", timestamp, payload: { ...payload, role } },
    ];
  }

  if (event.type === "tool_start") {
    return [{ type: "tool.call.started", timestamp, payload }];
  }

  if (event.type === "tool_complete") {
    return [{ type: "debate.tool.completed", timestamp, payload }];
  }

  if (event.type === "tool_error") {
    return [{ type: "debate.tool.failed", timestamp, payload }];
  }

  if (event.type === "final_start") {
    return [
      { type: "final.synthesis.started", timestamp, payload },
      { type: "model.call.started", timestamp, payload: { ...payload, role: "final" } },
    ];
  }

  if (event.type === "final_complete") {
    return [
      { type: "debate.completed", timestamp, payload },
      { type: "model.call.completed", timestamp, payload: { ...payload, role: "final" } },
    ];
  }

  if (event.type === "judge_complete") {
    return [
      { type: "model.call.completed", timestamp, payload: { ...payload, role: "judge" } },
      { type: "debate.judge.plan", timestamp, payload },
    ];
  }

  return [];
}

function structuredModelProvider(
  model: ReturnType<typeof createOpenRouterChatModelForRole>,
): StructuredDebateModelProvider & StructuredInformationModelProvider {
  return {
    withStructuredOutput: <T>(schema: unknown) => ({
      invoke: (input: unknown) =>
        (model.withStructuredOutput as (schema: unknown) => { invoke: (input: unknown) => Promise<T> })(schema).invoke(input),
    }),
  };
}

function createLocalDebateRunConfig(input: DebateCreateInput): DebateRunConfig {
  const debateConfig = resolveDebateAgentConfig(input.branch?.config);
  const humanInterjections = readHumanInterjections(input.payload.humanInterjections);
  return {
    debateId: safeId(
      firstNonEmptyString(
        readString(input.payload.debateId),
        readString(readJsonRecord(input.payload.escalation)?.debateId),
        `debate:${input.branch?.id ?? "manual"}:${new Date().toISOString()}`,
      ) ?? `debate:${randomUUID()}`,
    ),
    startInput: createLocalDebateStartInput(input),
    ...(humanInterjections.length > 0 ? { humanInterjections } : {}),
    budgets: {
      maxTurns: debateConfig.budgets?.maxTurns,
      maxToolCalls: debateConfig.budgets?.maxToolCalls,
    },
  };
}

async function loadRunHumanInterjections(
  context: LocalApiContext,
  runId: string,
): Promise<HumanInterjection[]> {
  const sourceRun = await context.store.getRun(runId);
  if (!sourceRun) return [];

  const events = await context.store.listRunEvents(runId);
  return events.flatMap((event) => {
    if (event.type !== "human.interjection") return [];
    const summary = readString(event.payload.message) ?? readString(event.payload.summary);
    if (!summary) return [];

    return [{
      timestamp: event.timestamp,
      summary,
    }];
  });
}

async function loadRunAndAncestorHumanInterjections(
  context: LocalApiContext,
  runId: string,
): Promise<HumanInterjection[]> {
  const sourceRun = await context.store.getRun(runId);
  if (!sourceRun) return [];

  const parentRunId = readString(sourceRun.input.sourceRunId);
  return mergeHumanInterjections(
    parentRunId ? await loadRunHumanInterjections(context, parentRunId) : [],
    await loadRunHumanInterjections(context, runId),
  );
}

function readHumanInterjections(value: unknown): HumanInterjection[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isJsonRecord(item)) return [];
    const summary = readString(item.summary) ?? readString(item.message);
    if (!summary) return [];

    return [{
      timestamp: readString(item.timestamp) ?? new Date().toISOString(),
      summary,
    }];
  });
}

function mergeHumanInterjections(
  ...groups: HumanInterjection[][]
): HumanInterjection[] {
  const seen = new Set<string>();
  const merged: HumanInterjection[] = [];

  for (const item of groups.flat()) {
    const key = `${item.timestamp}\n${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function createLocalDebateStartInput(input: DebateCreateInput): DebateStartInput {
  const escalation = readJsonRecord(input.payload.escalation);
  const branch = input.branch;
  const assets = branch?.config?.assets ?? [];
  const researchInstruction = branch?.config?.research?.exaInstruction?.trim() || undefined;
  const summary = [
    firstNonEmptyString(
      readString(input.payload.summary),
      readString(escalation?.summary),
      readString(readJsonRecord(escalation?.heartbeatOutput)?.summary),
      branch ? `Manual debate requested for branch ${branch.id}.` : "Manual Kairos debate requested.",
    ),
    branch ? `Branch: ${branch.name} (${branch.id})` : undefined,
    branch?.description ? `Branch description: ${branch.description}` : undefined,
    assets.length > 0 ? `Assets: ${assets.join(", ")}` : undefined,
    researchInstruction ? `Search and deep research instruction: ${researchInstruction}` : undefined,
  ].filter(Boolean).join("\n");

  return {
    summary,
    basicFinancials: {
      branchId: branch?.id ?? readString(input.payload.branchId) ?? readString(escalation?.branchId),
      lawId: branch?.lawId,
      law: branch?.law,
      assets,
      researchInstruction,
      escalation: escalation ?? null,
      input: input.payload,
    },
    ...(isJsonRecord(input.payload.portfolioContext)
      ? { portfolioContext: input.payload.portfolioContext }
      : {}),
  };
}

function debateResultOutput(result: DebateRunResult): JsonRecord {
  return {
    debateId: result.debateId,
    status: result.status,
    decision: result.finalDecision.action,
    summary: result.finalDecision.summary,
    finalDecision: result.finalDecision,
    messages: result.messages,
    toolEvents: result.toolEvents,
    humanInterjections: result.humanInterjections,
    currentPlan: result.currentPlan,
  };
}

function debateResultEvents(
  result: DebateRunResult,
  payload: JsonRecord,
  options: { includeStart?: boolean } = {},
): AppendRunEventInput[] {
  return [
    ...(options.includeStart === false
      ? []
      : [
          { type: "debate.created", payload: { debateId: result.debateId, payload } },
          { type: "debate.started", payload: { debateId: result.debateId } },
        ]),
    ...result.messages.map((message) => ({
      type: "debate.message",
      payload: message as unknown as JsonRecord,
    })),
    ...result.toolEvents.map((event) => ({
      type: event.status === "failed" ? "debate.tool.failed" : "debate.tool.completed",
      payload: event as unknown as JsonRecord,
    })),
    ...result.humanInterjections.map((interjection) => ({
      type: "human.interjection",
      timestamp: interjection.timestamp,
      payload: {
        author: "human",
        summary: interjection.summary,
        source: "debate_context",
      },
    })),
    ...(result.currentPlan
      ? [{ type: "debate.judge.plan", payload: result.currentPlan as unknown as JsonRecord }]
      : []),
    { type: "debate.judge.summary", payload: result.finalDecision as unknown as JsonRecord },
    { type: "debate.output", payload: debateResultOutput(result) },
  ];
}

function readJsonRecord(value: unknown): JsonRecord | undefined {
  return isJsonRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, "_");
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

function branchSupermemoryContainerTags(branch: BranchRecord): string[] {
  return [
    branchMemoryContainerTag(branch),
    branchProfileMemoryContainerTag(branch),
  ];
}

function branchMemoryContainerTag(branch: BranchRecord): string {
  return getMemoryContainerTag({
    configuredContainerTag: branch.config?.memory?.supermemoryContainerTag,
    scopeId: branch.id,
    prefix: "branch",
  });
}

function branchProfileMemoryContainerTag(branch: BranchRecord): string {
  return getMemoryContainerTag({
    configuredContainerTag: branch.config?.memory?.supermemoryProfileContainerTag,
    scopeId: branch.id,
    prefix: "branch_profile",
  });
}

function toHeartbeatBranchConfig(branch: BranchRecord): HeartbeatBranchConfig {
  const config = branch.config ?? {};
  const modelOverrides = branchConfigToModelOverrides(config);
  const heartbeatModel = resolveKairosModelConfig("heartbeat", undefined, modelOverrides).model;
  return {
    id: branch.id,
    name: branch.name,
    law: branchLawText(branch),
    assets: config.assets ?? [],
    heartbeat: {
      enabled: branch.enabled,
      intervalMinutes: config.heartbeat?.intervalMinutes ?? 5,
      seedWindowDays: config.heartbeat?.seedWindowDays ?? 30,
      model: heartbeatModel,
    },
    seededData: config.seededData,
    memory: readJsonRecord(config)?.memory as HeartbeatBranchConfig["memory"],
  };
}

function branchLawText(branch: BranchRecord): string {
  const law = branch.law;
  return firstNonEmptyString(
    readString(readJsonRecord(law)?.thesis),
    readString(readJsonRecord(law)?.watchFor),
    branch.description,
    branch.name,
  ) ?? "";
}

function heartbeatEnabledTools(
  branch: BranchRecord,
): Partial<Record<HeartbeatToolName, boolean>> {
  const tools = branch.config?.tools?.heartbeat;
  return {
    supermemory_profile: tools?.supermemory_profile?.enabled,
    supermemory_search: tools?.supermemory_search?.enabled,
    exa_news_search: tools?.exa_news_search?.enabled,
  };
}

function compactPortfolioContext(
  snapshot: PortfolioSnapshot | undefined,
  history: {
    brokerOrders?: unknown[];
    tradeIntents?: unknown[];
  } = {},
): JsonRecord | undefined {
  const recentTradeIntents = (history.tradeIntents ?? [])
    .slice(0, 8)
    .map((intent) =>
      compactRecordFields(intent, [
        "id",
        "symbol",
        "side",
        "status",
        "confidence",
        "notional",
        "qty",
        "orderType",
        "createdAt",
        "updatedAt",
      ]),
    );
  const recentBrokerOrders = (history.brokerOrders ?? [])
    .slice(0, 8)
    .map((order) =>
      compactRecordFields(order, [
        "id",
        "symbol",
        "side",
        "status",
        "type",
        "qty",
        "notional",
        "createdAt",
        "submittedAt",
      ]),
    );

  if (!snapshot && recentTradeIntents.length === 0 && recentBrokerOrders.length === 0) {
    return undefined;
  }

  return {
    ...(snapshot
      ? {
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
        }
      : {}),
    recentTradeIntents,
    recentBrokerOrders,
  };
}

function compactRecordFields(record: unknown, fields: string[]): JsonRecord {
  const source = readJsonRecord(record) ?? {};
  return Object.fromEntries(
    fields.flatMap((field) =>
      source[field] === undefined || source[field] === null
        ? []
        : [[field, source[field]]],
    ),
  );
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
  sizing?: {
    qty?: number;
    notional?: number;
    orderType?: "market" | "limit";
    limitPrice?: number;
    rationale?: string;
  };
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
    sizing: extractDecisionSizing(decisionObject.sizing),
    citations: Array.isArray(decisionObject.citations) ? decisionObject.citations : [],
  };
}

function extractDecisionSizing(value: unknown): {
  qty?: number;
  notional?: number;
  orderType?: "market" | "limit";
  limitPrice?: number;
  rationale?: string;
} | undefined {
  if (!isJsonRecord(value)) return undefined;
  const qty = typeof value.qty === "number" && value.qty > 0 ? value.qty : undefined;
  const notional =
    typeof value.notional === "number" && value.notional > 0
      ? value.notional
      : undefined;
  const orderType =
    value.orderType === "market" || value.orderType === "limit"
      ? value.orderType
      : undefined;
  const limitPrice =
    typeof value.limitPrice === "number" && value.limitPrice > 0
      ? value.limitPrice
      : undefined;
  const rationale =
    typeof value.rationale === "string" && value.rationale.trim().length > 0
      ? value.rationale.trim()
      : undefined;
  if (qty === undefined && notional === undefined) return undefined;
  return { qty, notional, orderType, limitPrice, rationale };
}

function resolveDecisionOrderType(
  sizing: ReturnType<typeof extractDecisionSizing>,
  tradingConfig: TradingConfig,
): "market" | "limit" {
  return tradingConfig.allowedOrderType ??
    sizing?.orderType ??
    tradingConfig.defaultOrderType ??
    "market";
}

function normalizeLimitPriceForSide(
  side: "buy" | "sell",
  value: number | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  const decimals = value >= 1 ? 2 : 4;
  const factor = 10 ** decimals;
  const normalized =
    side === "buy"
      ? Math.floor(value * factor) / factor
      : Math.ceil(value * factor) / factor;
  return Number(normalized.toFixed(decimals));
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
  return firstNonEmptyString(
    branch?.config?.trading?.symbols?.[0],
    branch?.config?.trading?.symbol,
    branch?.config?.assets?.[0],
  );
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
  | { name: "capabilityPreflight"; params: Record<string, never> }
  | { name: "listMarketSymbols"; params: Record<string, never> }
  | { name: "semanticMarketSymbols"; params: Record<string, never> }
  | { name: "listBranches"; params: Record<string, never> }
  | { name: "createBranch"; params: Record<string, never> }
  | { name: "getBranch"; params: { branchId: string } }
  | { name: "updateBranch"; params: { branchId: string } }
  | { name: "deleteBranch"; params: { branchId: string } }
  | { name: "listRuns"; params: Record<string, never> }
  | { name: "listRouterChats"; params: Record<string, never> }
  | { name: "createRouterChat"; params: Record<string, never> }
  | { name: "deleteRouterChat"; params: { chatId: string } }
  | { name: "listRouterMessages"; params: { chatId: string } }
  | { name: "createRouterMessage"; params: { chatId: string } }
  | { name: "getRun"; params: { runId: string } }
  | { name: "listRunEvents"; params: { runId: string } }
  | { name: "triggerHeartbeat"; params: { branchId: string } }
  | { name: "createDebate"; params: Record<string, never> }
  | { name: "appendInterjection"; params: { runId: string } }
  | { name: "cancelRun"; params: { runId: string } }
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

  if (method === "GET" && (pathname === "/" || pathname === "/health")) return { name: "health", params: {} };
  if (method === "GET" && pathname === "/openrouter/models") return { name: "listOpenRouterModels", params: {} };
  if (method === "GET" && pathname === "/capabilities/preflight") return { name: "capabilityPreflight", params: {} };
  if (method === "GET" && pathname === "/market/symbols") return { name: "listMarketSymbols", params: {} };
  if (method === "POST" && pathname === "/market/symbols/semantic") return { name: "semanticMarketSymbols", params: {} };
  if (method === "GET" && pathname === "/portfolio") return { name: "getPortfolio", params: {} };
  if (method === "POST" && pathname === "/portfolio/refresh") return { name: "refreshPortfolio", params: {} };
  if (segments.length === 2 && segments[0] === "router" && segments[1] === "chats") {
    if (method === "GET") return { name: "listRouterChats", params: {} };
    if (method === "POST") return { name: "createRouterChat", params: {} };
  }
  if (segments.length === 3 && segments[0] === "router" && segments[1] === "chats" && method === "DELETE") {
    return { name: "deleteRouterChat", params: { chatId: segments[2] } };
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
  if (segments.length === 3 && segments[0] === "runs" && segments[2] === "cancel" && method === "POST") {
    return { name: "cancelRun", params: { runId: segments[1] } };
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
  const text = await readTextWithLimit(request, maxJsonBodyBytes());
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError(maxBytes);
    }
    output += decoder.decode(chunk.value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

function maxJsonBodyBytes(): number {
  const configured = Number(process.env.KAIROS_MAX_JSON_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_JSON_BODY_BYTES;
}

function json(body: unknown, status = 200): Response {
  const requestId = requestLogContext.getStore()?.requestId;
  const responseBody =
    status >= 400 && isJsonRecord(body) && requestId
      ? { ...body, requestId }
      : body;
  return new Response(JSON.stringify(redactSensitiveResponseValues(responseBody)), {
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

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-methods");
  headers.delete("access-control-allow-headers");
  headers.delete("vary");
  Object.entries(cors).forEach(([key, value]) => headers.set(key, String(value)));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const requestId =
    requestLogContext.getStore()?.requestId ??
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ??
    randomUUID();
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function logLocalApiRequest(response: Response, request: Request, url: URL): void {
  const context = requestLogContext.getStore();
  const durationMs = context ? Date.now() - context.startedAt : undefined;
  console.info("[kairos] local api request", {
    requestId: context?.requestId,
    method: request.method,
    path: url.pathname,
    status: response.status,
    durationMs,
    origin: request.headers.get("origin") ?? undefined,
  });
}

function corsHeaders(requestOrigin?: string | null): HeadersInit {
  const allowedOrigin = corsAllowedOrigin(requestOrigin);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": [
      "authorization",
      "content-type",
      IDEMPOTENCY_KEY_HEADER,
      LOCAL_REQUEST_HEADER,
      LOCAL_TOKEN_HEADER,
      REQUEST_ID_HEADER,
    ].join(","),
    "vary": "Origin",
  };
  if (allowedOrigin) {
    headers["access-control-allow-origin"] = allowedOrigin;
  }
  return headers;
}

function corsAllowedOrigin(requestOrigin?: string | null): string | undefined {
  const configured = configuredCorsOrigins();
  const origin = requestOrigin?.trim();
  if (!origin) return configured[0] ?? "http://127.0.0.1:5173";
  if (configured.includes(origin) || (allowLoopbackCors() && isLoopbackOrigin(origin))) {
    return origin;
  }
  return undefined;
}

function configuredCorsOrigins(): string[] {
  const value = process.env.KAIROS_CORS_ORIGIN ?? process.env.VITE_KAIROS_APP_ORIGIN;
  return (value ? value.split(",") : ["http://127.0.0.1:5173"])
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function allowLoopbackCors(): boolean {
  return parseAuthEnabledFlag(process.env.KAIROS_ALLOW_LOOPBACK_CORS) ??
    !isProductionRuntime();
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.KAIROS_DEPLOYMENT_ENV === "production";
}

function redactSensitiveResponseValues(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveResponseValues(item, seen));
  }
  if (!isJsonRecord(value)) return value;
  if (seen.has(value)) return "[redacted:circular]";
  seen.add(value);
  const redacted = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_RESPONSE_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redactSensitiveResponseValues(item, seen),
    ]),
  );
  seen.delete(value);
  return redacted;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function formatSseEvent(event: { id: string; type: string; timestamp: string; payload: JsonRecord }): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { MemoryKairosStore, SupabaseKairosStore };
