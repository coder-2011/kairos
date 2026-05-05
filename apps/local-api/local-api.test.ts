import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalApi,
  createLocalApiHandler,
  MemoryKairosStore,
  serveLocalApi,
  SupabaseKairosStore,
  type LocalApiContext,
} from "./src/server.js";
import type { PaperTradingBroker } from "../../src/trading/index.js";
import type { TradingTelegramNotifier } from "../../src/notifications/index.js";
import { TelegramBotClient } from "../../src/api/telegram.js";
import {
  recordProviderUsage,
  type SupermemoryMirror,
  type SupermemoryMirrorRecord,
} from "../../src/global/index.js";

const baseUrl = "http://kairos.local";
const originalAuthEnabled = process.env.KAIROS_AUTH_ENABLED;

function marketSymbol(symbol: string, name: string) {
  return {
    symbol,
    name,
    exchange: "NASDAQ",
    tradable: true,
    source: "alpaca" as const,
  };
}

describe("local API handler", () => {
  beforeEach(() => {
    process.env.KAIROS_AUTH_ENABLED = "false";
  });

  afterEach(() => {
    if (originalAuthEnabled === undefined) {
      delete process.env.KAIROS_AUTH_ENABLED;
    } else {
      process.env.KAIROS_AUTH_ENABLED = originalAuthEnabled;
    }
  });

  it("responds to health checks", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "kairos-local-api" });
  });

  it("allows the active loopback web origin when a stale CORS origin remains configured", async () => {
    const previousCorsOrigin = process.env.KAIROS_CORS_ORIGIN;
    process.env.KAIROS_CORS_ORIGIN = "http://127.0.0.1:5174";
    try {
      const { request } = makeClient({ origin: "http://127.0.0.1:5173" });

      const response = await request("GET", "/health");

      expect(response.headers.get("access-control-allow-origin")).toBe(
        "http://127.0.0.1:5173",
      );
    } finally {
      if (previousCorsOrigin === undefined) {
        delete process.env.KAIROS_CORS_ORIGIN;
      } else {
        process.env.KAIROS_CORS_ORIGIN = previousCorsOrigin;
      }
    }
  });

  it("responds to root checks", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("GET", "/");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "kairos-local-api" });
  });

  it("persists provider usage events through the request-scoped store sink", async () => {
    const { requestJson } = makeClient({
      headers: { "x-request-id": "usage_request_1" },
      runHeartbeat: async ({ branchId }) => {
        await recordProviderUsage({
          provider: "openrouter",
          operation: "heartbeat.generateText",
          status: "succeeded",
          branchId,
          providerRequestId: "generation_1",
          model: "openai/gpt-5.1-mini",
          costUsd: 0.0042,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        });
        return {
          output: { branchId, decision: "monitor" },
          events: [{ type: "heartbeat.decision", payload: { decision: "monitor" } }],
        };
      },
    });

    await requestJson("POST", "/branches", {
      id: "branch_usage",
      name: "Usage branch",
    });
    const heartbeat = await requestJson("POST", "/branches/branch_usage/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });
    const usage = await requestJson("GET", "/usage-events?provider=openrouter&limit=5");

    expect(heartbeat.status).toBe(201);
    expect(usage.status).toBe(200);
    expect(usage.body.usageEvents).toHaveLength(1);
    expect(usage.body.usageEvents[0]).toMatchObject({
      provider: "openrouter",
      operation: "heartbeat.generateText",
      status: "succeeded",
      requestId: "usage_request_1",
      branchId: "branch_usage",
      providerRequestId: "generation_1",
      model: "openai/gpt-5.1-mini",
      costUsd: 0.0042,
      totalTokens: 120,
    });
  });

  it("requires a local request header when Supabase auth is disabled", async () => {
    const { requestJson } = makeClient({ omitLocalRequestHeader: true });

    const response = await requestJson("GET", "/branches");

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: "unauthorized",
    });
  });

  it("rejects non-health routes without bearer auth when Supabase auth is enabled", async () => {
    const previousAuthEnabled = process.env.KAIROS_AUTH_ENABLED;
    process.env.KAIROS_AUTH_ENABLED = "true";
    try {
      const { requestJson } = makeClient({ omitLocalRequestHeader: true });

      const response = await requestJson("GET", "/branches");

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "unauthorized",
        message: "Missing authorization token.",
      });
    } finally {
      if (previousAuthEnabled === undefined) {
        delete process.env.KAIROS_AUTH_ENABLED;
      } else {
        process.env.KAIROS_AUTH_ENABLED = previousAuthEnabled;
      }
    }
  });

  it("refuses unauthenticated off-loopback API binding", async () => {
    const previousAuthEnabled = process.env.KAIROS_AUTH_ENABLED;
    process.env.KAIROS_AUTH_ENABLED = "false";
    try {
      await expect(
        serveLocalApi({
          hostname: "0.0.0.0",
          port: 0,
          dependencies: { store: new MemoryKairosStore() },
        }),
      ).rejects.toThrow("Refusing to bind unauthenticated Kairos API");
    } finally {
      if (previousAuthEnabled === undefined) {
        delete process.env.KAIROS_AUTH_ENABLED;
      } else {
        process.env.KAIROS_AUTH_ENABLED = previousAuthEnabled;
      }
    }
  });

  it("requires the configured local API token when Supabase auth is disabled", async () => {
    const previousToken = process.env.KAIROS_LOCAL_API_TOKEN;
    process.env.KAIROS_LOCAL_API_TOKEN = "local-secret";
    try {
      const rejected = await makeClient({ localApiToken: "wrong" }).requestJson("GET", "/branches");
      expect(rejected.status).toBe(401);

      const accepted = await makeClient({ localApiToken: "local-secret" }).requestJson(
        "GET",
        "/branches",
      );
      expect(accepted.status).toBe(200);
    } finally {
      if (previousToken === undefined) {
        delete process.env.KAIROS_LOCAL_API_TOKEN;
      } else {
        process.env.KAIROS_LOCAL_API_TOKEN = previousToken;
      }
    }
  });

  it("enforces the production API security envelope end to end", async () => {
    const previous = {
      corsOrigin: process.env.KAIROS_CORS_ORIGIN,
      allowLoopbackCors: process.env.KAIROS_ALLOW_LOOPBACK_CORS,
      requireIdempotency: process.env.KAIROS_REQUIRE_IDEMPOTENCY,
      rateLimitEnabled: process.env.KAIROS_RATE_LIMIT_ENABLED,
      rateLimitMax: process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS,
      rateLimitWindow: process.env.KAIROS_RATE_LIMIT_WINDOW_MS,
    };
    process.env.KAIROS_CORS_ORIGIN = "https://kairos.example";
    process.env.KAIROS_ALLOW_LOOPBACK_CORS = "false";
    process.env.KAIROS_REQUIRE_IDEMPOTENCY = "true";
    process.env.KAIROS_RATE_LIMIT_ENABLED = "true";
    process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.KAIROS_RATE_LIMIT_WINDOW_MS = "60000";

    try {
      const disallowedCors = await makeClient({
        origin: "http://127.0.0.1:5173",
        headers: { "x-forwarded-for": "203.0.113.9" },
      }).request("GET", "/health");
      expect(disallowedCors.headers.get("access-control-allow-origin")).toBeNull();
      expect(disallowedCors.headers.get("x-request-id")).toBeTruthy();

      const limitedClient = makeClient({
        headers: { "x-forwarded-for": "203.0.113.10" },
      });
      expect((await limitedClient.requestJson("GET", "/branches")).status).toBe(200);
      const rateLimited = await limitedClient.requestJson("GET", "/runs");
      expect(rateLimited.status).toBe(429);
      expect(rateLimited.body).toMatchObject({
        error: "rate_limited",
      });
      expect(rateLimited.body.requestId).toBeTruthy();

      process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS = "100";
      const missingIdempotency = await makeClient({
        headers: { "x-forwarded-for": "203.0.113.11" },
      }).requestJson("POST", "/debates", { input: {} });
      expect(missingIdempotency.status).toBe(400);
      expect(missingIdempotency.body).toMatchObject({
        error: "idempotency_key_required",
      });

      const secretResponse = await makeClient({
        headers: { "x-forwarded-for": "203.0.113.12" },
      }).requestJson("POST", "/branches", {
        name: "Security branch",
        metadata: {
          apiKey: "sk-provider-secret",
          nested: { token: "session-token" },
          stack: "raw stack trace",
        },
      });
      expect(secretResponse.status).toBe(201);
      expect(JSON.stringify(secretResponse.body)).not.toContain("sk-provider-secret");
      expect(JSON.stringify(secretResponse.body)).not.toContain("session-token");
      expect(JSON.stringify(secretResponse.body)).not.toContain("raw stack trace");

      let debateRuns = 0;
      const idempotentClient = makeClient({
        headers: {
          "idempotency-key": "debate-security-test",
          "x-forwarded-for": "203.0.113.13",
        },
        createDebate: async () => {
          debateRuns += 1;
          return {
            output: {
              decision: "needs_review",
              apiKey: "model-provider-secret",
            },
            events: [{ type: "debate.created", payload: {} }],
          };
        },
      });
      const firstDebate = await idempotentClient.request("POST", "/debates", { input: {} });
      const firstBody = await firstDebate.text();
      const replayedDebate = await idempotentClient.request("POST", "/debates", { input: {} });
      const replayedBody = await replayedDebate.text();

      expect(firstDebate.status).toBe(201);
      expect(replayedDebate.status).toBe(201);
      expect(replayedDebate.headers.get("x-idempotency-cache")).toBe("hit");
      expect(debateRuns).toBe(1);
      expect(firstBody).toBe(replayedBody);
      expect(firstBody).not.toContain("model-provider-secret");
    } finally {
      restoreEnv("KAIROS_CORS_ORIGIN", previous.corsOrigin);
      restoreEnv("KAIROS_ALLOW_LOOPBACK_CORS", previous.allowLoopbackCors);
      restoreEnv("KAIROS_REQUIRE_IDEMPOTENCY", previous.requireIdempotency);
      restoreEnv("KAIROS_RATE_LIMIT_ENABLED", previous.rateLimitEnabled);
      restoreEnv("KAIROS_RATE_LIMIT_MAX_REQUESTS", previous.rateLimitMax);
      restoreEnv("KAIROS_RATE_LIMIT_WINDOW_MS", previous.rateLimitWindow);
    }
  });

  it("persists rate limits, idempotency, and queued agent jobs across handler instances", async () => {
    const previous = {
      requireIdempotency: process.env.KAIROS_REQUIRE_IDEMPOTENCY,
      rateLimitEnabled: process.env.KAIROS_RATE_LIMIT_ENABLED,
      rateLimitMax: process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS,
      rateLimitWindow: process.env.KAIROS_RATE_LIMIT_WINDOW_MS,
      enqueueJobs: process.env.KAIROS_ENQUEUE_AGENT_JOBS,
    };
    process.env.KAIROS_REQUIRE_IDEMPOTENCY = "true";
    process.env.KAIROS_RATE_LIMIT_ENABLED = "true";
    process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.KAIROS_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.KAIROS_ENQUEUE_AGENT_JOBS = "true";

    try {
      const store = new MemoryKairosStore();
      let debateExecutions = 0;
      const createDebate: LocalApiContext["createDebate"] = async ({ runId }) => {
        debateExecutions += 1;
        return {
          output: { runId, decision: "needs_review" },
          events: [{ type: "debate.judge.summary", payload: { decision: "needs_review" } }],
        };
      };

      const firstLimited = await makeClient({
        store,
        createDebate,
        headers: { "x-forwarded-for": "203.0.113.31" },
      }).requestJson("GET", "/branches");
      expect(firstLimited.status).toBe(200);
      const secondLimited = await makeClient({
        store,
        createDebate,
        headers: { "x-forwarded-for": "203.0.113.31" },
      }).requestJson("GET", "/runs");
      expect(secondLimited.status).toBe(429);

      process.env.KAIROS_RATE_LIMIT_MAX_REQUESTS = "100";
      const firstDebate = await makeClient({
        store,
        createDebate,
        headers: {
          "idempotency-key": "durable-debate-job",
          "x-forwarded-for": "203.0.113.32",
        },
      }).requestJson("POST", "/debates", { input: { topic: "durable job" } });
      expect(firstDebate.status).toBe(202);
      expect(firstDebate.body.run).toMatchObject({
        kind: "debate",
        status: "pending",
      });
      expect(debateExecutions).toBe(0);

      const replayedDebate = await makeClient({
        store,
        createDebate,
        headers: {
          "idempotency-key": "durable-debate-job",
          "x-forwarded-for": "203.0.113.33",
        },
      }).requestJson("POST", "/debates", { input: { topic: "durable job" } });
      expect(replayedDebate.status).toBe(202);
      expect(replayedDebate.body.run.id).toBe(firstDebate.body.run.id);
      expect(debateExecutions).toBe(0);

      const drained = await makeClient({
        store,
        createDebate,
        headers: { "x-forwarded-for": "203.0.113.34" },
      }).requestJson("POST", "/jobs/drain", { limit: 5 });
      expect(drained.status).toBe(200);
      expect(drained.body.results).toEqual([
        expect.objectContaining({
          runId: firstDebate.body.run.id,
          status: "succeeded",
        }),
      ]);
      expect(debateExecutions).toBe(1);

      const emptyDrain = await makeClient({
        store,
        createDebate,
        headers: { "x-forwarded-for": "203.0.113.35" },
      }).requestJson("POST", "/jobs/drain", { limit: 5 });
      expect(emptyDrain.status).toBe(200);
      expect(emptyDrain.body.results).toEqual([]);
      expect(debateExecutions).toBe(1);

      const deepChat = await makeClient({
        store,
        createDebate,
        headers: { "x-forwarded-for": "203.0.113.36" },
      }).requestJson("POST", "/deep-research/chats", { title: "Durable research" });
      const deepMessage = await makeClient({
        store,
        createDebate,
        headers: {
          "idempotency-key": "durable-deep-research-job",
          "x-forwarded-for": "203.0.113.37",
        },
      }).requestJson(
        "POST",
        `/deep-research/chats/${deepChat.body.chat.id}/messages`,
        { text: "Research this later.", model: "openai/gpt-5.5" },
      );
      expect(deepMessage.status).toBe(202);
      expect(deepMessage.body.run).toMatchObject({
        kind: "deep_research",
        status: "pending",
      });

      const tradingBroker = {
        async getPortfolioSnapshot() {
          return {
            provider: "alpaca" as const,
            environment: "paper" as const,
            account: {
              status: "ACTIVE",
              cash: 1000,
              buyingPower: 1000,
              portfolioValue: 1000,
              equity: 1000,
              unrealizedPl: 0,
              daytradeCount: 0,
              patternDayTrader: false,
              tradingBlocked: false,
              accountBlocked: false,
            },
            positions: [],
          };
        },
        async getClock() {
          return { isOpen: true };
        },
        async getAsset() {
          return { tradable: true };
        },
        async submitPaperOrder() {
          throw new Error("not used");
        },
      } as unknown as PaperTradingBroker;
      const queuedBrokerSync = await makeClient({
        store,
        createDebate,
        tradingBroker,
        headers: { "x-forwarded-for": "203.0.113.38" },
      }).requestJson("POST", "/portfolio/refresh");
      expect(queuedBrokerSync.status).toBe(202);
      expect(queuedBrokerSync.body.run).toMatchObject({
        kind: "broker_sync",
        status: "pending",
      });

      const drainedBrokerSync = await makeClient({
        store,
        createDebate,
        tradingBroker,
        headers: { "x-forwarded-for": "203.0.113.39" },
      }).requestJson("POST", "/jobs/drain", { limit: 5, kinds: ["broker_sync"] });
      expect(drainedBrokerSync.status).toBe(200);
      expect(drainedBrokerSync.body.results).toEqual([
        expect.objectContaining({
          runId: queuedBrokerSync.body.run.id,
          status: "succeeded",
        }),
      ]);
    } finally {
      restoreEnv("KAIROS_REQUIRE_IDEMPOTENCY", previous.requireIdempotency);
      restoreEnv("KAIROS_RATE_LIMIT_ENABLED", previous.rateLimitEnabled);
      restoreEnv("KAIROS_RATE_LIMIT_MAX_REQUESTS", previous.rateLimitMax);
      restoreEnv("KAIROS_RATE_LIMIT_WINDOW_MS", previous.rateLimitWindow);
      restoreEnv("KAIROS_ENQUEUE_AGENT_JOBS", previous.enqueueJobs);
    }
  });

  it("rejects oversized JSON request bodies", async () => {
    const previousLimit = process.env.KAIROS_MAX_JSON_BODY_BYTES;
    process.env.KAIROS_MAX_JSON_BODY_BYTES = "32";
    try {
      const { requestJson } = makeClient();

      const response = await requestJson("POST", "/branches", {
        name: "This payload is intentionally too large for the test limit",
      });

      expect(response.status).toBe(413);
      expect(response.body).toMatchObject({
        error: "payload_too_large",
        maxBytes: 32,
      });
    } finally {
      if (previousLimit === undefined) {
        delete process.env.KAIROS_MAX_JSON_BODY_BYTES;
      } else {
        process.env.KAIROS_MAX_JSON_BODY_BYTES = previousLimit;
      }
    }
  });

  it("rejects oversized Deep Research JSON request bodies", async () => {
    const previousLimit = process.env.KAIROS_MAX_JSON_BODY_BYTES;
    process.env.KAIROS_MAX_JSON_BODY_BYTES = "32";
    try {
      const { requestJson } = makeClient();

      const response = await requestJson("POST", "/deep-research/chats", {
        title: "This Deep Research payload is intentionally too large",
      });

      expect(response.status).toBe(413);
      expect(response.body).toMatchObject({
        error: "payload_too_large",
        maxBytes: 32,
      });
    } finally {
      if (previousLimit === undefined) {
        delete process.env.KAIROS_MAX_JSON_BODY_BYTES;
      } else {
        process.env.KAIROS_MAX_JSON_BODY_BYTES = previousLimit;
      }
    }
  });

  it("lists market symbols through the configured symbol provider", async () => {
    const { requestJson } = makeClient({
      marketSymbolProvider: {
        async listMarketSymbols(input) {
          expect(input).toEqual({ query: "pltr", limit: 25 });
          return [
            {
              symbol: "PLTR",
              name: "Palantir Technologies Inc.",
              exchange: "NASDAQ",
              tradable: true,
              price: 25.5,
              dayChangePercent: 2,
              source: "alpaca",
            },
          ];
        },
      },
    });

    const response = await requestJson("GET", "/market/symbols?query=pltr&limit=25");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      count: 1,
      source: "alpaca_assets",
      cacheTags: ["market-symbols", "market-symbols:query:PLTR"],
      symbols: [
        {
          symbol: "PLTR",
          price: 25.5,
        },
      ],
    });
  });

  it("loads the uncapped ticker directory without quote enrichment by default", async () => {
    const allSymbols = Array.from({ length: 1200 }, (_, index) =>
      marketSymbol(`T${index}`, `Ticker ${index}`),
    );
    const { requestJson } = makeClient({
      marketSymbolProvider: {
        async listMarketSymbols(input) {
          expect(input).toEqual({ includeQuotes: false });
          return allSymbols;
        },
      },
    });

    const response = await requestJson("GET", "/market/symbols");

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1200);
    expect(response.body.symbols).toHaveLength(1200);
  });

  it("finds semantically related market symbols for branch creation", async () => {
    const { requestJson } = makeClient({
      marketSymbolProvider: {
        async listMarketSymbols() {
          return [
            marketSymbol("SNOW", "Snowflake Inc."),
            marketSymbol("SHOP", "Shopify Inc."),
          ];
        },
        async getMarketSymbols(symbols) {
          return symbols
            .filter((symbol) => ["NVDA", "SMCI", "ANET"].includes(symbol))
            .map((symbol) => marketSymbol(symbol, `${symbol} Corp.`));
        },
      },
    });

    const response = await requestJson("POST", "/market/symbols/semantic", {
      query: "obvious tech infra related ones",
      limit: 5,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "semantic_symbol_search",
      count: 3,
    });
    expect(response.body.symbols.map((item: { symbol: string }) => item.symbol).sort()).toEqual([
      "ANET",
      "NVDA",
      "SMCI",
    ]);
  });

  it("uses curated semantic symbols without fanning out broad Alpaca searches", async () => {
    let listCalls = 0;
    const { requestJson } = makeClient({
      marketSymbolProvider: {
        async listMarketSymbols() {
          listCalls += 1;
          return [];
        },
        async getMarketSymbols(symbols) {
          return symbols.map((symbol) => marketSymbol(symbol, `${symbol} Corp.`));
        },
      },
    });

    const response = await requestJson("POST", "/market/symbols/semantic", {
      query: "semiconductor data center networking",
      limit: 8,
    });

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(8);
    expect(listCalls).toBe(0);
    expect(response.body.symbols.map((item: { symbol: string }) => item.symbol)).toContain("NVDA");
  });

  it("does not synthesize starter tickers when the symbol directory is unavailable", async () => {
    const { requestJson } = makeClient({
      marketSymbolProvider: {
        async listMarketSymbols() {
          throw new Error("NASDAQ Trader unavailable");
        },
      },
    });

    const response = await requestJson("GET", "/market/symbols?query=pltr&limit=25");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      count: 0,
      source: "unavailable",
      cacheTags: ["market-symbols", "market-symbols:query:PLTR"],
      symbols: [],
      error: "NASDAQ Trader unavailable",
    });
  });

  it("supports branch create, list, get, update, and delete", async () => {
    const { requestJson } = makeClient();

    const created = await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      lawId: "law_pltr_deals",
      name: "PLTR deals",
      law: { watchFor: "credible new deals" },
    });
    expect(created.status).toBe(201);
    expect(created.body.branch).toMatchObject({ id: "branch_pltr_deals", enabled: true });

    const listed = await requestJson("GET", "/branches");
    expect(listed.body.branches).toHaveLength(1);

    const fetched = await requestJson("GET", "/branches/branch_pltr_deals");
    expect(fetched.body.branch.name).toBe("PLTR deals");

    const updated = await requestJson("PATCH", "/branches/branch_pltr_deals", { enabled: false });
    expect(updated.body.branch.enabled).toBe(false);

    const deleted = await requestJson("DELETE", "/branches/branch_pltr_deals");
    expect(deleted.status).toBe(204);

    const missing = await requestJson("GET", "/branches/branch_pltr_deals");
    expect(missing.status).toBe(404);
  });

  it("triggers normal heartbeat runs by default and exposes run events", async () => {
    const { requestJson } = makeClient();
    await requestJson("POST", "/branches", {
      id: "branch_1",
      name: "Branch 1",
      config: {
        assets: ["PLTR"],
        heartbeat: { intervalMinutes: 5, seedWindowDays: 30 },
        tools: {
          information: {
            exa_search: { enabled: false },
          },
        },
      },
    });

    const created = await requestJson("POST", "/branches/branch_1/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });

    expect(created.status).toBe(201);
    expect(created.body.run).toMatchObject({
      kind: "heartbeat",
      status: "succeeded",
      branchId: "branch_1",
    });
    expect(created.body.run.output.decision).toBe("monitor");
    expect(created.body.run.input.branch.config.tools.information.exa_search.enabled).toBe(false);

    const listedRuns = await requestJson("GET", "/runs");
    expect(listedRuns.body.runs).toHaveLength(1);

    const fetchedRun = await requestJson("GET", `/runs/${created.body.run.id}`);
    expect(fetchedRun.body.run.id).toBe(created.body.run.id);

    const events = await requestJson("GET", `/runs/${created.body.run.id}/events`);
    expect(events.body.events.map((event: { type: string }) => event.type)).toEqual([
      "run.started",
      "heartbeat.seeded",
      "heartbeat.decision",
      "run.completed",
    ]);
  });

  it("creates normal debate runs from escalation-like payloads by default", async () => {
    const { requestJson } = makeClient();
    await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      name: "PLTR deals",
      config: {
        prompts: {
          debateBullSystemPrompt: "Custom bull",
        },
      },
    });

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_deals",
        summary: "Potentially material contract news.",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.run).toMatchObject({
      kind: "debate",
      status: "succeeded",
      branchId: "branch_pltr_deals",
    });
    expect(response.body.run.input.branch.config.prompts.debateBullSystemPrompt).toBe(
      "Custom bull",
    );
    expect(response.body.run.output.decision).toBe("needs_review");
  });

  it("injects the latest cached portfolio context into debate runs", async () => {
    const debatePayloads: unknown[] = [];
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ payload }) => {
        debatePayloads.push(payload);
        return {
          output: { decision: "needs_review" },
          events: [{ type: "debate.created", payload }],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      name: "PLTR deals",
      config: { assets: ["PLTR"] },
    });
    await requestJson("POST", "/portfolio/refresh");

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_deals",
        summary: "Potentially material contract news.",
      },
    });

    expect(response.status).toBe(201);
    expect(debatePayloads[0]).toMatchObject({
      portfolioContext: {
        account: {
          cash: 100000,
          buyingPower: 100000,
          portfolioValue: 100000,
        },
        positions: [{ symbol: "PLTR", qty: 10 }],
      },
    });
  });

  it("fails debate runs instead of leaving them running when the workflow times out", async () => {
    const previousTimeout = process.env.KAIROS_DEBATE_TIMEOUT_MS;
    process.env.KAIROS_DEBATE_TIMEOUT_MS = "5";
    try {
      const { requestJson } = makeClient({
        createDebate: async () => new Promise(() => {}),
      });
      await requestJson("POST", "/branches", {
        id: "branch_pltr_deals",
        name: "PLTR deals",
        description: "Watch for material PLTR deals.",
        config: { assets: ["PLTR"] },
      });

      const response = await requestJson("POST", "/debates", {
        input: { branchId: "branch_pltr_deals" },
      });

      expect(response.status).toBe(500);
      expect(response.body.run.status).toBe("failed");
      expect(response.body.run.output).toMatchObject({ interrupted: true });

      const events = await requestJson("GET", `/runs/${response.body.run.id}/events`);
      expect(events.body.events.map((event: { type: string }) => event.type)).toContain("debate.failed");
      expect(events.body.events.map((event: { type: string }) => event.type)).toContain("run.failed");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.KAIROS_DEBATE_TIMEOUT_MS;
      } else {
        process.env.KAIROS_DEBATE_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it("keeps debates canceled when user cancels async debate execution", async () => {
    const { requestJson } = makeClient({
      createDebate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { output: { decision: "needs_review" } };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      name: "PLTR deals",
      config: { assets: ["PLTR"] },
    });

    const started = await requestJson("POST", "/debates", {
      async: true,
      input: { branchId: "branch_pltr_deals" },
    });
    expect(started.status).toBe(202);
    expect(started.body.run.status).toBe("pending");

    const canceled = await requestJson("POST", `/runs/${started.body.run.id}/cancel`);
    expect(canceled.status).toBe(200);
    expect(canceled.body.run.status).toBe("canceled");

    await new Promise((resolve) => setTimeout(resolve, 120));

    const run = await requestJson("GET", `/runs/${started.body.run.id}`);
    expect(run.body.run.status).toBe("canceled");

    const events = await requestJson("GET", `/runs/${started.body.run.id}/events`);
    const eventTypes = events.body.events.map((event: { type: string }) => event.type);
    expect(eventTypes).toContain("run.canceled");
    expect(eventTypes).not.toContain("run.completed");
    expect(eventTypes).not.toContain("debate.completed");
  });

  it("reports branch capability preflight readiness without exposing secrets", async () => {
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      const { requestJson } = makeClient();
      await requestJson("POST", "/branches", {
        id: "branch_pltr_deals",
        name: "PLTR deals",
        description: "Watch for material PLTR deals.",
        config: { assets: ["PLTR"] },
      });

      const response = await requestJson("GET", "/capabilities/preflight?branchId=branch_pltr_deals");

      expect(response.status).toBe(200);
      expect(response.body.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "openrouter_key", status: "ready" }),
          expect.objectContaining({ id: "law", status: "ready" }),
          expect.objectContaining({ id: "assets", status: "ready" }),
        ]),
      );
      expect(JSON.stringify(response.body)).not.toContain("test-key");
    } finally {
      if (previousOpenRouter === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousOpenRouter;
      }
    }
  });

  it("creates a sell-side paper intent from a sell debate decision when holdings exist", async () => {
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ payload }) => ({
        output: {
          finalDecision: {
            summary: "Bear case says the branch thesis is broken.",
            action: "sell",
            confidence: 0.91,
            citations: [],
          },
        },
        events: [{ type: "debate.created", payload }],
      }),
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      name: "PLTR deals",
      config: {
        assets: ["PLTR"],
        trading: {
          mode: "paper",
          notifyConfidenceThreshold: 0.65,
          paperTradeConfidenceThreshold: 0.85,
          paperAutoBuyEnabled: false,
        },
      },
    });
    await requestJson("POST", "/portfolio/refresh");

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_deals",
        summary: "Potentially thesis-breaking news.",
      },
    });
    const intents = await requestJson("GET", "/trade-intents");

    expect(response.status).toBe(201);
    expect(intents.body.tradeIntents).toEqual([
      expect.objectContaining({
        symbol: "PLTR",
        side: "sell",
        qty: 10,
        status: "draft",
      }),
    ]);
  });

  it("routes chat text to matching branches and wakes their heartbeat agents", async () => {
    const heartbeatPayloads: unknown[] = [];
    const { requestJson } = makeClient({
      runHeartbeat: async ({ branchId, payload }) => {
        heartbeatPayloads.push({ branchId, payload });
        return {
          output: {
            branchId,
            decision: "monitor",
            summary: `Router woke ${branchId}.`,
          },
          events: [
            { type: "heartbeat.seeded", payload },
            { type: "heartbeat.decision", payload: { decision: "monitor" } },
          ],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_contracts",
      name: "PLTR contracts",
      description: "Palantir government contracts",
      config: { assets: ["PLTR"] },
      law: { thesis: "Watch for new Palantir government deals." },
    });
    await requestJson("POST", "/branches", {
      id: "branch_unrelated",
      name: "Semiconductor supply chain",
      config: { assets: ["NVDA"] },
    });
    const chat = await requestJson("POST", "/router/chats");

    const response = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR signed a new government contract according to this note.",
    });

    expect(response.status).toBe(201);
    expect(response.body.run).toMatchObject({
      kind: "router",
      status: "succeeded",
    });
    expect(response.body.run.output.branchIds).toEqual(["branch_pltr_contracts"]);
    expect(response.body.assistantMessage.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "branch_inventory",
          status: "succeeded",
        }),
        expect.objectContaining({
          name: "heartbeat_wakeup",
          status: "succeeded",
        }),
      ]),
    );
    expect(response.body.heartbeatRuns).toHaveLength(1);
    expect(heartbeatPayloads).toHaveLength(1);
    expect(heartbeatPayloads[0]).toMatchObject({
      branchId: "branch_pltr_contracts",
      payload: {
        origin: "router",
        messageText: "PLTR signed a new government contract according to this note.",
      },
    });

    const messages = await requestJson("GET", `/router/chats/${chat.body.chat.id}/messages`);
    expect(messages.body.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.body.messages[1].toolCalls).toEqual(response.body.assistantMessage.toolCalls);
  });

  it("injects saved branch config into heartbeat, debate, and router wakeup payloads", async () => {
    const heartbeatInputs: unknown[] = [];
    const debateInputs: unknown[] = [];
    const branchConfig = {
      assets: ["PLTR"],
      heartbeat: { intervalMinutes: 7, seedWindowDays: 14, maxToolSteps: 2 },
      prompts: {
        heartbeatSystemPrompt: "Heartbeat config injection prompt",
        debateJudgeSystemPrompt: "Judge config injection prompt",
        debateBullSystemPrompt: "Bull config injection prompt",
        debateBearSystemPrompt: "Bear config injection prompt",
      },
      tools: {
        heartbeat: {
          exa_news_search: { enabled: false },
        },
        debate: {
          information: { enabled: true },
        },
        information: {
          exa_search: { enabled: true },
          supermemory_search: { enabled: true },
        },
        finnhubPremiumAccess: true,
      },
      budgets: {
        debateMaxTurns: 4,
        debateMaxToolCalls: 2,
        informationMaxToolCalls: 3,
      },
      thresholds: {
        notifyConfidence: 0.66,
        paperTradeDraftConfidence: 0.88,
      },
      trading: {
        mode: "paper",
        symbol: "PLTR",
        symbols: ["PLTR"],
        paperAutoBuyEnabled: false,
        notifyOnBuySignal: true,
        maxNotionalPerOrder: 123,
        maxOpenPositionNotionalPerSymbol: 456,
        allowedOrderType: "market",
      },
      research: {
        exaInstruction: "Use the saved branch research instruction.",
        dataPacket: "PLTR",
      },
    };
    const { requestJson } = makeClient({
      runHeartbeat: async ({ branchId, payload, branch }) => {
        heartbeatInputs.push({ branchId, payload, branch });
        return {
          output: { branchId, decision: "monitor" },
          events: [{ type: "heartbeat.seeded", payload }],
        };
      },
      createDebate: async ({ payload, branch }) => {
        debateInputs.push({ payload, branch });
        return {
          output: { decision: "needs_review" },
          events: [{ type: "debate.created", payload }],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_config_injection",
      name: "PLTR config injection",
      description: "Palantir government contracts",
      config: branchConfig,
      law: { thesis: "Watch for new Palantir government deals." },
    });

    const heartbeat = await requestJson("POST", "/branches/branch_config_injection/heartbeat-runs", {
      input: { source: "direct" },
    });
    const debate = await requestJson("POST", "/debates", {
      input: {
        branchId: "branch_config_injection",
        escalation: { branchId: "branch_config_injection", summary: "Needs review." },
      },
    });
    const chat = await requestJson("POST", "/router/chats");
    await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR signed a new government contract.",
    });

    expect(heartbeat.body.run.input.branch.config).toMatchObject(branchConfig);
    expect(debate.body.run.input.branch.config).toMatchObject(branchConfig);
    expect(heartbeatInputs[0]).toMatchObject({
      payload: { branch: { config: branchConfig } },
      branch: { config: branchConfig },
    });
    expect(debateInputs[0]).toMatchObject({
      payload: { branch: { config: branchConfig } },
      branch: { config: branchConfig },
    });
    expect(heartbeatInputs[1]).toMatchObject({
      payload: {
        origin: "router",
        branch: { config: branchConfig },
      },
      branch: { config: branchConfig },
    });
  });

  it("records router messages without waking heartbeats when no branches exist", async () => {
    const { requestJson } = makeClient({
      runHeartbeat: async () => {
        throw new Error("heartbeat should not run without branches");
      },
    });
    const chat = await requestJson("POST", "/router/chats");

    const response = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "This source mentions PLTR government contracts.",
    });

    expect(response.status).toBe(201);
    expect(response.body.run.output.branchIds).toEqual([]);
    expect(response.body.heartbeatRuns).toEqual([]);
    expect(response.body.assistantMessage.text).toContain("there are no branches yet");
    expect(response.body.assistantMessage.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "branch_inventory",
          output: { branches: [] },
          status: "succeeded",
        }),
      ]),
    );
  });

  it("mirrors router uploaded documents into Supermemory", async () => {
    const mirrored: SupermemoryMirrorRecord[] = [];
    const { requestJson } = makeClient({
      supermemoryMirror: createMockMirror(mirrored),
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_contracts",
      name: "PLTR contracts",
      description: "Palantir government contracts",
      config: { assets: ["PLTR"] },
    });
    const chat = await requestJson("POST", "/router/chats");

    const response = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR contract note",
      attachments: [
        {
          id: "doc_1",
          name: "contract.pdf",
          mimeType: "application/pdf",
          path: "/tmp/contract.pdf",
        },
      ],
    });

    expect(response.status).toBe(201);
    const routerSources = mirrored.filter(
      (record) => record.type === "router.source.ingested",
    );
    expect(routerSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "source",
          artifactId: "doc_1",
          content: "PDF attachment preserved for extraction: contract.pdf",
          metadata: expect.objectContaining({ source_kind: "pdf" }),
        }),
      ]),
    );
    expect(routerSources.at(-1)?.data).toMatchObject({
      attachments: [
        {
          id: "doc_1",
          name: "contract.pdf",
          mimeType: "application/pdf",
          path: "/tmp/contract.pdf",
        },
      ],
      branchIds: ["branch_pltr_contracts"],
    });
    expect(routerSources.at(-1)?.containerTags).toEqual(
      expect.arrayContaining([
        "branch_branch_pltr_contracts",
        "branch_profile_branch_pltr_contracts",
      ]),
    );
  });

  it("uses configured branch Supermemory profile tags for router mirrors", async () => {
    const mirrored: SupermemoryMirrorRecord[] = [];
    const { requestJson } = makeClient({
      supermemoryMirror: createMockMirror(mirrored),
    });
    await requestJson("POST", "/branches", {
      id: "branch_custom_memory",
      name: "Custom memory branch",
      config: {
        assets: ["PLTR"],
        memory: {
          supermemoryContainerTag: "branch_raw_custom",
          supermemoryProfileContainerTag: "branch_profile_custom",
        },
      },
    });
    const chat = await requestJson("POST", "/router/chats");

    const response = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR custom memory note",
    });

    expect(response.status).toBe(201);
    const routerSource = mirrored.find(
      (record) => record.type === "router.source.ingested",
    );
    expect(routerSource?.containerTags).toEqual(
      expect.arrayContaining(["branch_raw_custom", "branch_profile_custom"]),
    );
    expect(routerSource?.containerTags).not.toEqual(
      expect.arrayContaining(["branch_branch_custom_memory", "branch_profile_branch_custom_memory"]),
    );
  });

  it("appends human interjections to run events", async () => {
    const { requestJson } = makeClient();
    const debate = await requestJson("POST", "/debates", {
      escalation: { branchId: "branch_1", summary: "Escalation" },
    });

    const interjection = await requestJson("POST", `/runs/${debate.body.run.id}/interjections`, {
      message: "The contract may be a recompete, not new demand.",
    });

    expect(interjection.status).toBe(201);
    expect(interjection.body.event).toMatchObject({
      runId: debate.body.run.id,
      type: "human.interjection",
      payload: {
        author: "human",
        message: "The contract may be a recompete, not new demand.",
      },
    });
  });

  it("passes source-run human interjections into debate context", async () => {
    const debatePayloads: unknown[] = [];
    const { requestJson } = makeClient({
      runHeartbeat: async ({ branchId, payload }) => ({
        output: {
          branchId,
          decision: "escalate",
          summary: "Material contract headline.",
          escalationEvent: {
            branchId,
            summary: "Material contract headline.",
          },
        },
        events: [
          { type: "heartbeat.seeded", payload },
          { type: "heartbeat.decision", payload: { decision: "escalate" } },
        ],
      }),
      createDebate: async ({ payload }) => {
        debatePayloads.push(payload);
        return {
          output: {
            decision: "watch",
            humanInterjections: payload.humanInterjections,
          },
          events: [{ type: "debate.created", payload }],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      name: "PLTR deals",
    });
    const heartbeat = await requestJson("POST", "/branches/branch_pltr_deals/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });
    const interjection = await requestJson(
      "POST",
      `/runs/${heartbeat.body.run.id}/interjections`,
      { message: "This may be a recompete, not incremental demand." },
    );

    const debate = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_deals",
        sourceRunId: heartbeat.body.run.id,
        summary: "Material contract headline.",
      },
    });

    expect(debate.status).toBe(201);
    expect(debatePayloads[0]).toMatchObject({
      sourceRunId: heartbeat.body.run.id,
      humanInterjections: [
        {
          timestamp: interjection.body.event.timestamp,
          summary: "This may be a recompete, not incremental demand.",
        },
      ],
    });
    expect(debate.body.run.input.humanInterjections).toEqual([
      {
        timestamp: interjection.body.event.timestamp,
        summary: "This may be a recompete, not incremental demand.",
      },
    ]);
  });

  it("fans router-origin information out to multiple branches without cross-branch blocking", async () => {
    const heartbeatPayloads: Array<{ branchId: string; payload: any }> = [];
    const { requestJson } = makeClient({
      runHeartbeat: async ({ branchId, payload }) => {
        heartbeatPayloads.push({ branchId, payload });
        if (branchId === "branch_pltr_fail") {
          throw new Error("branch model unavailable");
        }
        return {
          output: { branchId, decision: "monitor" },
          events: [{ type: "heartbeat.seeded", payload }],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_contracts",
      name: "PLTR contracts",
      description: "Palantir government contracts",
      config: { assets: ["PLTR"] },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_fail",
      name: "PLTR budget risk",
      description: "Palantir government budget risk",
      config: { assets: ["PLTR"] },
    });
    const chat = await requestJson("POST", "/router/chats");

    const response = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR government contract and budget update.",
    });

    expect(response.status).toBe(201);
    expect(response.body.run.status).toBe("succeeded");
    expect(response.body.heartbeatRuns).toHaveLength(1);
    expect(response.body.heartbeatAttemptRuns).toEqual([
      expect.objectContaining({ id: response.body.heartbeatRuns[0].id }),
      expect.objectContaining({
        branchId: "branch_pltr_fail",
        status: "failed",
        output: { error: "branch model unavailable" },
      }),
    ]);
    expect(response.body.heartbeatFailures).toEqual([
      expect.objectContaining({
        branchId: "branch_pltr_fail",
        run: expect.objectContaining({
          branchId: "branch_pltr_fail",
          status: "failed",
        }),
        error: "branch model unavailable",
      }),
    ]);
    expect(response.body.run.output).toMatchObject({
      branchIds: ["branch_pltr_contracts", "branch_pltr_fail"],
      heartbeatRunIds: [response.body.heartbeatRuns[0].id],
      heartbeatFailures: [
        expect.objectContaining({
          branchId: "branch_pltr_fail",
          error: "branch model unavailable",
        }),
      ],
    });
    expect(heartbeatPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: "branch_pltr_contracts",
          payload: expect.objectContaining({
            origin: "router",
            sourceRunId: response.body.run.id,
          }),
        }),
        expect.objectContaining({
          branchId: "branch_pltr_fail",
          payload: expect.objectContaining({
            origin: "router",
            sourceRunId: response.body.run.id,
          }),
        }),
      ]),
    );
    expect(response.body.assistantMessage.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "heartbeat_wakeup",
          status: "succeeded",
          input: { branchId: "branch_pltr_contracts" },
        }),
        expect.objectContaining({
          name: "heartbeat_wakeup",
          status: "failed",
          input: { branchId: "branch_pltr_fail" },
          error: "branch model unavailable",
        }),
      ]),
    );
  });

  it("carries router-level human interjections into branch debates", async () => {
    const debatePayloads: unknown[] = [];
    const { requestJson } = makeClient({
      runHeartbeat: async ({ branchId, payload }) => ({
        output: {
          branchId,
          decision: "escalate",
          escalationEvent: {
            branchId,
            summary: "Router-origin source needs debate.",
          },
        },
        events: [{ type: "heartbeat.seeded", payload }],
      }),
      createDebate: async ({ payload }) => {
        debatePayloads.push(payload);
        return {
          output: { decision: "watch" },
          events: [{ type: "debate.created", payload }],
        };
      },
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_contracts",
      name: "PLTR contracts",
      description: "Palantir government contracts",
      config: { assets: ["PLTR"] },
    });
    const chat = await requestJson("POST", "/router/chats");
    const router = await requestJson("POST", `/router/chats/${chat.body.chat.id}/messages`, {
      text: "PLTR signed a new government contract.",
    });
    const interjection = await requestJson(
      "POST",
      `/runs/${router.body.run.id}/interjections`,
      { message: "Treat the submitted note as unverified until sourced." },
    );
    const heartbeatRun = router.body.heartbeatRuns[0];

    const debate = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_contracts",
        sourceRunId: heartbeatRun.id,
        summary: "Router-origin source needs debate.",
      },
    });

    expect(debate.status).toBe(201);
    expect(debatePayloads[0]).toMatchObject({
      sourceRunId: heartbeatRun.id,
      humanInterjections: [
        {
          timestamp: interjection.body.event.timestamp,
          summary: "Treat the submitted note as unverified until sourced.",
        },
      ],
    });
  });

  it("deletes router chats and their messages through the chat endpoint", async () => {
    const { requestJson } = makeClient();
    const chat = await requestJson("POST", "/router/chats");
    const message = await requestJson(
      "POST",
      `/router/chats/${chat.body.chat.id}/messages`,
      { text: "PLTR contract appears in press release." },
    );

    expect(message.status).toBe(201);

    const deleted = await requestJson("DELETE", `/router/chats/${chat.body.chat.id}`);
    expect(deleted.status).toBe(204);

    const remainingChats = await requestJson("GET", "/router/chats");
    expect(remainingChats.body.chats.map((next: { id: string }) => next.id)).not.toContain(
      chat.body.chat.id,
    );

    const missingMessages = await requestJson(
      "GET",
      `/router/chats/${chat.body.chat.id}/messages`,
    );
    expect(missingMessages.status).toBe(404);
  });

  it("deletes deep research chats and conversation history", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "kairos-deep-research-"));
    const previousDeepResearchDir = process.env.KAIROS_DEEP_RESEARCH_DATA_DIR;
    process.env.KAIROS_DEEP_RESEARCH_DATA_DIR = dataDir;

    try {
      const { handler } = await createLocalApi({ dataDir });
      const requestJson = apiClient(handler);

      const created = await requestJson("POST", "/deep-research/chats");
      expect(created.status).toBe(201);

      const chatId = created.body.chat.id;
      const listBefore = await requestJson("GET", "/deep-research/chats");
      expect(listBefore.body.chats.map((next: { id: string }) => next.id)).toContain(chatId);

      const deleted = await requestJson("DELETE", `/deep-research/chats/${chatId}`);
      expect(deleted.status).toBe(204);

      const listAfter = await requestJson("GET", "/deep-research/chats");
      expect(listAfter.body.chats.map((next: { id: string }) => next.id)).not.toContain(chatId);

      const missingMessages = await requestJson(
        "GET",
        `/deep-research/chats/${chatId}/messages`,
      );
      expect(missingMessages.status).toBe(404);
    } finally {
      if (previousDeepResearchDir === undefined) {
        delete process.env.KAIROS_DEEP_RESEARCH_DATA_DIR;
      } else {
        process.env.KAIROS_DEEP_RESEARCH_DATA_DIR = previousDeepResearchDir;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("streams historical run events as SSE", async () => {
    const { requestJson, request } = makeClient();
    const debate = await requestJson("POST", "/debates", {
      escalation: { branchId: "branch_1", summary: "Escalation" },
    });

    const response = await request("GET", `/runs/${debate.body.run.id}/events/stream`);
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    const chunk = await reader!.read();
    await reader!.cancel();

    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: run.started");
    expect(text).toContain("data:");
  });

  it("uses the real local runtime store in default API mode", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "kairos-local-api-"));

    try {
      const { handler } = await createLocalApi({ dataDir });
      const response = await handler(
        new Request(`${baseUrl}/branches`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...localApiRequestHeaders(),
          },
          body: JSON.stringify({
            id: "branch_runtime",
            name: "Runtime branch",
            config: { assets: ["PLTR"] },
          }),
        }),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.branch).toMatchObject({
        id: "branch_runtime",
        name: "Runtime branch",
        enabled: true,
        config: { assets: ["PLTR"] },
      });

      const heartbeat = await handler(
        new Request(`${baseUrl}/branches/branch_runtime/heartbeat-runs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...localApiRequestHeaders(),
          },
          body: JSON.stringify({ input: { source: "test" } }),
        }),
      );

      expect(heartbeat.status).toBe(500);
      const heartbeatBody = await heartbeat.json();
      expect(heartbeatBody).toMatchObject({
        error: "run_failed",
        run: {
          kind: "heartbeat",
          status: "failed",
          branchId: "branch_runtime",
        },
      });
      expect(heartbeatBody.message).toContain("OPENROUTER_API_KEY is required to run the heartbeat agent");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("mirrors local API writes into Supermemory records", async () => {
    const mirrored: SupermemoryMirrorRecord[] = [];
    const { handler } = await createLocalApi({
      dependencies: {
        store: new MemoryKairosStore(),
        supermemoryMirror: createMockMirror(mirrored),
        runHeartbeat: async ({ branchId, payload }) => ({
          output: { branchId, decision: "monitor", summary: "Heartbeat summary" },
          events: [
            { type: "heartbeat.seeded", payload },
            { type: "heartbeat.decision", payload: { decision: "monitor" } },
          ],
        }),
        createDebate: async ({ payload }) => ({
          output: {
            decision: "needs_review",
            confidence: 0.7,
            summary: "Debate found a notification-worthy catalyst.",
          },
          events: [
            { type: "debate.created", payload },
            { type: "debate.judge.summary", payload: { decision: "needs_review" } },
          ],
        }),
      },
    });
    const requestJson = apiClient(handler);

    await requestJson("POST", "/branches", {
      id: "branch_memory",
      lawId: "law_memory",
      name: "Memory branch",
      config: { assets: ["PLTR"] },
      law: { watchFor: "new material contracts" },
    });
    const routerChat = await requestJson("POST", "/router/chats");
    await requestJson("POST", `/router/chats/${routerChat.body.chat.id}/messages`, {
      text: "PLTR may have a new material contract.",
    });
    const heartbeat = await requestJson("POST", "/branches/branch_memory/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });
    const debate = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_memory",
        summary: "Potential material contract.",
      },
    });
    await requestJson("POST", `/runs/${debate.body.run.id}/interjections`, {
      message: "Check whether this is a recompete.",
    });
    await requestJson("POST", "/trade-intents", tradeIntentPayload({
      branchId: "branch_memory",
      lawId: "law_memory",
      sourceRunId: debate.body.run.id,
      confidence: 0.9,
      tradingConfig: {
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
      },
    }));

    expect(heartbeat.status).toBe(201);
    expect(mirrored.map((record) => record.type)).toEqual(
      expect.arrayContaining([
        "branch.created",
        "router_chat.created",
        "router_message.user",
        "router_message.assistant",
        "run.created",
        "run.updated",
        "heartbeat.seeded",
        "heartbeat.decision",
        "debate.created",
        "debate.judge.summary",
        "human.interjection",
        "debate.output",
        "trading.threshold.evaluated",
        "trade_intent.created",
        "trading_message.paper_trade_candidate",
      ]),
    );
    expect(
      mirrored.find((record) => record.type === "human.interjection"),
    ).toMatchObject({
      scope: "run_event",
      runId: debate.body.run.id,
      branchId: "branch_memory",
    });
    expect(
      mirrored.find((record) => record.type === "trade_intent.created"),
    ).toMatchObject({
      scope: "trade_intent",
      branchId: "branch_memory",
      lawId: "law_memory",
    });
    expect(
      mirrored.find((record) => record.type === "router_message.user"),
    ).toMatchObject({
      scope: "router",
      actor: "human",
    });
    expect(
      mirrored.find((record) => record.type === "router.source.ingested"),
    ).toMatchObject({
      containerTags: expect.arrayContaining([
        "branch_branch_memory",
        "branch_profile_branch_memory",
      ]),
    });
  });

  it("keeps local API writes working when Supermemory mirroring fails", async () => {
    const { handler } = await createLocalApi({
      dependencies: {
        store: new MemoryKairosStore(),
        supermemoryMirror: {
          async mirrorRecord() {
            throw new Error("supermemory unavailable");
          },
          async mirrorDebateResult() {
            throw new Error("supermemory unavailable");
          },
          async mirrorInformationResult() {
            throw new Error("supermemory unavailable");
          },
        },
      },
    });
    const requestJson = apiClient(handler);

    const response = await requestJson("POST", "/branches", {
      id: "branch_best_effort",
      name: "Best effort",
    });

    expect(response.status).toBe(201);
    expect(response.body.branch).toMatchObject({ id: "branch_best_effort" });
  });

  it("can use Supabase as the same API store backend for app, deep research, and trading records", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const records = new Map<string, { collection: string; id: string; record: unknown }>();
    const store = new SupabaseKairosStore({
      url: "https://example.supabase.co",
      serviceRoleKey: "service_role_test",
      fetchImpl: (async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, url: url.toString(), body });

        if (method === "POST" && body) {
          records.set(`${body.collection}:${body.id}`, body);
          return jsonResponse(null);
        }

        if (method === "GET") {
          const collection = url.searchParams.get("collection")?.replace(/^eq\./, "");
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          const runId = url.searchParams.get("record->>runId")?.replace(/^eq\./, "");
          const chatId = url.searchParams.get("record->>chatId")?.replace(/^eq\./, "");
          const rows = [...records.values()].filter((row) => {
            const record = row.record as { runId?: string; chatId?: string };
            return (
              (!collection || row.collection === collection) &&
              (!id || row.id === id) &&
              (!runId || record.runId === runId) &&
              (!chatId || record.chatId === chatId)
            );
          });
          return jsonResponse(rows);
        }

        if (method === "DELETE") {
          const collection = url.searchParams.get("collection")?.replace(/^eq\./, "");
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          const key = `${collection}:${id}`;
          const row = records.get(key);
          records.delete(key);
          return jsonResponse(row ? [row] : []);
        }

        return jsonResponse({ error: "unexpected request" }, 500);
      }) as typeof fetch,
    });
    const { requestJson } = makeClient({ store });

    const created = await requestJson("POST", "/branches", {
      id: "branch_supabase",
      name: "Supabase branch",
    });
    const run = await requestJson("POST", "/branches/branch_supabase/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });
    expect(run.status).toBe(201);
    const events = await requestJson("GET", `/runs/${run.body.run.id}/events`);
    const routerChat = await requestJson("POST", "/router/chats", {
      title: "Supabase router",
    });
    await requestJson("POST", `/router/chats/${routerChat.body.chat.id}/messages`, {
      text: "PLTR contract source.",
    });
    const deepResearchChat = await requestJson("POST", "/deep-research/chats", {
      id: "deep_supabase",
      title: "Deep Supabase",
    });
    await store.createDeepResearchMessage({
      id: "deep_message_supabase",
      chatId: deepResearchChat.body.chat.id,
      role: "user",
      text: "Research PLTR contract quality.",
      toolCalls: [{
        id: "tool_1",
        name: "exa_search",
        status: "succeeded",
        summary: "Found source.",
        createdAt: "2026-05-04T12:00:00.000Z",
      }],
    });
    const deepMessages = await requestJson(
      "GET",
      `/deep-research/chats/${deepResearchChat.body.chat.id}/messages`,
    );
    const tradeIntent = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      id: "trade_intent_supabase",
      confidence: 0.9,
      tradingConfig: {
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
      },
    }));
    await store.createBrokerOrder({
      provider: "alpaca",
      environment: "paper",
      tradeIntentId: "trade_intent_supabase",
      clientOrderId: "client_supabase_order",
      status: "accepted",
      symbol: "PLTR",
      side: "buy",
      orderType: "market",
      timeInForce: "day",
      notional: 250,
      submittedAt: "2026-05-04T12:00:00.000Z",
    });
    await store.createPortfolioSnapshot({
      provider: "alpaca",
      environment: "paper",
      account: { buyingPower: 100000 },
      positions: [{ symbol: "PLTR", qty: 3 }],
    });

    expect(created.status).toBe(201);
    expect(events.body.events.map((event: { type: string }) => event.type)).toEqual([
      "run.started",
      "heartbeat.seeded",
      "heartbeat.decision",
      "run.completed",
    ]);
    expect(deepMessages.body.messages).toEqual([
      expect.objectContaining({
        id: "deep_message_supabase",
        chatId: "deep_supabase",
        role: "user",
        toolCalls: [expect.objectContaining({ name: "exa_search" })],
      }),
    ]);
    expect(tradeIntent.status).toBe(201);
    expect(await store.listTradeIntents()).toEqual([
      expect.objectContaining({ id: "trade_intent_supabase" }),
    ]);
    expect(await store.listMessages()).toHaveLength(1);
    expect(await store.listBrokerOrders()).toEqual([
      expect.objectContaining({ clientOrderId: "client_supabase_order" }),
    ]);
    expect(await store.listPortfolioSnapshots()).toEqual([
      expect.objectContaining({
        provider: "alpaca",
        positions: [expect.objectContaining({ symbol: "PLTR" })],
      }),
    ]);
    expect([...new Set([...records.values()].map((row) => row.collection))]).toEqual(
      expect.arrayContaining([
        "branches",
        "runs",
        "run_events",
        "router_chats",
        "router_messages",
        "deep_research_chats",
        "deep_research_messages",
        "trade_intents",
        "messages",
        "broker_orders",
        "portfolio_snapshots",
      ]),
    );
    expect(requests.some((request) => request.url.includes("/rest/v1/kairos_records"))).toBe(true);
  });

  it("creates a message and trade intent when confidence crosses the trading threshold without auto-submit", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      confidence: 0.9,
      tradingConfig: {
        mode: "enabled",
        notifyConfidenceThreshold: 0.65,
        tradeConfidenceThreshold: 0.85,
        autoTradeEnabled: false,
      },
    }));

    expect(response.status).toBe(201);
    expect(response.body.policy).toMatchObject({
      thresholdResult: "paper_trade_candidate",
      permittedAction: "paper_trade_intent",
      autoTradeEnabled: false,
      paperAutoBuyEnabled: false,
      paperAutoTradeEnabled: false,
    });
    expect(response.body.tradeIntent).toMatchObject({
      symbol: "PLTR",
      mode: "paper",
      status: "paper_ready",
    });
    expect(response.body.messages).toHaveLength(1);

    const messages = await requestJson("GET", "/messages");
    expect(messages.body.messages).toHaveLength(1);

    const intents = await requestJson("GET", "/trade-intents");
    expect(intents.body.tradeIntents).toHaveLength(1);

    const brokerOrders = await requestJson("GET", "/broker-orders");
    expect(brokerOrders.body.brokerOrders).toHaveLength(0);
  });

  it("blocks trade intent creation when max order notional is exceeded", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      notional: 600,
      confidence: 0.9,
      tradingConfig: {
        mode: "enabled",
        notifyConfidenceThreshold: 0.65,
        tradeConfidenceThreshold: 0.85,
        autoTradeEnabled: false,
        maxNotionalPerOrder: 500,
      },
    }));

    expect(response.status).toBe(422);
    expect(response.body.tradeIntent).toBeNull();
    expect(response.body.preflight).toEqual({
      ok: false,
      reasons: ["Intent exceeds configured max order notional 500."],
    });

    const intents = await requestJson("GET", "/trade-intents");
    expect(intents.body.tradeIntents).toHaveLength(0);
  });

  it("blocks trade intent creation when max position notional would be exceeded", async () => {
    const { requestJson } = makeClient({ tradingBroker: createMockTradingBroker() });
    await requestJson("POST", "/portfolio/refresh");

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      notional: 300,
      confidence: 0.9,
      tradingConfig: {
        mode: "enabled",
        notifyConfidenceThreshold: 0.65,
        tradeConfidenceThreshold: 0.85,
        autoTradeEnabled: false,
        maxOpenPositionNotionalPerSymbol: 500,
      },
    }));

    expect(response.status).toBe(422);
    expect(response.body.tradeIntent).toBeNull();
    expect(response.body.preflight).toEqual({
      ok: false,
      reasons: ["Intent would exceed configured max open position notional 500 for PLTR."],
    });

    const intents = await requestJson("GET", "/trade-intents");
    expect(intents.body.tradeIntents).toHaveLength(0);
  });

  it("sends a Telegram notification when confidence crosses the notify threshold", async () => {
    const sent: unknown[] = [];
    const { requestJson } = makeClient({
      notificationSender: {
        async send(input) {
          sent.push(input);
          return {
            body: "PLTR alert 90%",
            provider: "telegram",
            chatId: "12345",
            messageId: 7,
            sent: true,
          };
        },
      },
    });

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      confidence: 0.7,
      tradingConfig: {
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
      },
    }));

    expect(response.status).toBe(201);
    expect(sent).toHaveLength(1);

    const messages = await requestJson("GET", "/messages");
    expect(messages.body.messages.map((message: { type: string }) => message.type)).toEqual([
      "threshold_notify",
      "telegram_notification_sent",
    ]);
  });

  it("binds Telegram chats from a verified /start webhook", async () => {
    const telegramRequests: unknown[] = [];
    const { requestJson } = makeClient({
      telegramBot: new TelegramBotClient({
        token: "bot_token",
        webhookSecret: "secret",
        fetchImpl: async (_url, init) => {
          telegramRequests.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({
            ok: true,
            result: { message_id: 42, chat: { id: 12345, type: "private" } },
          }), { headers: { "content-type": "application/json" } });
        },
      }),
      headers: { "x-telegram-bot-api-secret-token": "secret" },
    });

    const response = await requestJson("POST", "/telegram/webhook", {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1,
        text: "/start",
        chat: { id: 12345, type: "private", username: "naman" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, action: "bound" });
    expect(telegramRequests).toEqual([
      {
        chat_id: "12345",
        text: expect.stringContaining("Kairos Telegram alerts are connected"),
        disable_web_page_preview: true,
      },
    ]);
  });

  it("preflights and submits an Alpaca order when auto-submit is enabled", async () => {
    const { requestJson } = makeClient({ tradingBroker: createMockTradingBroker() });

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      confidence: 0.91,
      tradingConfig: {
        mode: "enabled",
        notifyConfidenceThreshold: 0.65,
        tradeConfidenceThreshold: 0.85,
        autoTradeEnabled: true,
      },
    }));

    expect(response.status).toBe(201);
    expect(response.body.tradeIntent).toMatchObject({ status: "paper_submitted" });
    expect(response.body.brokerOrder).toMatchObject({
      provider: "alpaca",
      environment: "paper",
      symbol: "PLTR",
      status: "accepted",
    });
    expect(response.body.preflight).toEqual({ ok: true, reasons: [] });

    const brokerOrders = await requestJson("GET", "/broker-orders");
    expect(brokerOrders.body.brokerOrders).toHaveLength(1);
  });

  it("submits a judge-proposed buy limit order to Alpaca with limit_price", async () => {
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ payload }) => ({
        output: {
          finalDecision: {
            summary: "Bull case supports a controlled limit entry.",
            action: "buy",
            confidence: 0.91,
            sizing: {
              notional: 500,
              orderType: "limit",
              limitPrice: 24.987,
              rationale: "Buy only below the current reference price.",
            },
            citations: [],
          },
        },
        events: [{ type: "debate.created", payload }],
      }),
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_buy_limit",
      name: "PLTR buy limit",
      config: {
        assets: ["PLTR"],
        trading: {
          mode: "paper",
          notifyConfidenceThreshold: 0.65,
          paperTradeConfidenceThreshold: 0.85,
          paperAutoBuyEnabled: true,
        },
      },
    });

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_buy_limit",
        summary: "Potentially material contract news.",
      },
    });
    const intents = await requestJson("GET", "/trade-intents");
    const brokerOrders = await requestJson("GET", "/broker-orders");

    expect(response.status).toBe(201);
    expect(intents.body.tradeIntents).toEqual([
      expect.objectContaining({
        symbol: "PLTR",
        side: "buy",
        orderType: "limit",
        limitPrice: 24.98,
        status: "paper_submitted",
      }),
    ]);
    expect(brokerOrders.body.brokerOrders).toEqual([
      expect.objectContaining({
        symbol: "PLTR",
        side: "buy",
        orderType: "limit",
        limitPrice: 24.98,
      }),
    ]);
  });

  it("blocks a judge-proposed buy that exceeds max order notional instead of capping it", async () => {
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ payload }) => ({
        output: {
          finalDecision: {
            summary: "Bull case asks for more notional than policy allows.",
            action: "buy",
            confidence: 0.91,
            sizing: {
              notional: 600,
              orderType: "market",
              rationale: "Oversized test order.",
            },
            citations: [],
          },
        },
        events: [{ type: "debate.created", payload }],
      }),
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_max_order_block",
      name: "PLTR max order block",
      config: {
        assets: ["PLTR"],
        trading: {
          mode: "paper",
          notifyConfidenceThreshold: 0.65,
          paperTradeConfidenceThreshold: 0.85,
          paperAutoBuyEnabled: true,
          maxNotionalPerOrder: 500,
        },
      },
    });

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_max_order_block",
        summary: "Potentially material contract news.",
      },
    });
    const intents = await requestJson("GET", "/trade-intents");
    const messages = await requestJson("GET", "/messages");

    expect(response.status).toBe(201);
    expect(intents.body.tradeIntents).toHaveLength(0);
    expect(messages.body.messages).toEqual([
      expect.objectContaining({
        type: "paper_order_blocked",
        body: "Intent exceeds configured max order notional 500.",
      }),
    ]);
  });

  it("preflights and submits an Alpaca paper sell order against cached holdings", async () => {
    const { requestJson } = makeClient({ tradingBroker: createMockTradingBroker() });

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      side: "sell",
      qty: 5,
      notional: undefined,
      confidence: 0.91,
      tradingConfig: {
        mode: "paper",
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
        paperAutoBuyEnabled: true,
      },
    }));

    expect(response.status).toBe(201);
    expect(response.body.tradeIntent).toMatchObject({
      side: "sell",
      status: "paper_submitted",
    });
    expect(response.body.brokerOrder).toMatchObject({
      side: "sell",
      symbol: "PLTR",
      qty: 5,
    });
    expect(response.body.preflight).toEqual({ ok: true, reasons: [] });
  });

  it("submits a judge-proposed sell limit order to Alpaca with limit_price", async () => {
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ payload }) => ({
        output: {
          finalDecision: {
            summary: "Bear case supports trimming above the minimum exit price.",
            action: "sell",
            confidence: 0.91,
            sizing: {
              qty: 5,
              orderType: "limit",
              limitPrice: 25.001,
              rationale: "Sell only at or above the selected minimum price.",
            },
            citations: [],
          },
        },
        events: [{ type: "debate.created", payload }],
      }),
    });
    await requestJson("POST", "/branches", {
      id: "branch_pltr_sell_limit",
      name: "PLTR sell limit",
      config: {
        assets: ["PLTR"],
        trading: {
          mode: "paper",
          notifyConfidenceThreshold: 0.65,
          paperTradeConfidenceThreshold: 0.85,
          paperAutoBuyEnabled: true,
        },
      },
    });
    await requestJson("POST", "/portfolio/refresh");

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_sell_limit",
        summary: "Potentially thesis-breaking news.",
      },
    });
    const intents = await requestJson("GET", "/trade-intents");
    const brokerOrders = await requestJson("GET", "/broker-orders");

    expect(response.status).toBe(201);
    expect(intents.body.tradeIntents).toEqual([
      expect.objectContaining({
        symbol: "PLTR",
        side: "sell",
        qty: 5,
        orderType: "limit",
        limitPrice: 25.01,
        status: "paper_submitted",
      }),
    ]);
    expect(brokerOrders.body.brokerOrders).toEqual([
      expect.objectContaining({
        symbol: "PLTR",
        side: "sell",
        qty: 5,
        orderType: "limit",
        limitPrice: 25.01,
      }),
    ]);
  });

  it("refreshes and persists portfolio snapshots through the trading broker", async () => {
    const { requestJson } = makeClient({
      tradingBroker: {
        ...createMockTradingBroker(),
        async listPaperOrders() {
          return [
            {
              id: "external_broker_order_1",
              createdAt: "2026-05-03T12:00:00.000Z",
              updatedAt: "2026-05-03T12:00:00.000Z",
              provider: "alpaca",
              environment: "paper",
              alpacaOrderId: "external_alpaca_order_1",
              clientOrderId: "manual_alpaca_paper_order",
              status: "accepted",
              symbol: "PLTR",
              side: "buy",
              orderType: "market",
              timeInForce: "day",
              notional: 250,
              submittedAt: "2026-05-03T12:00:00.000Z",
            },
          ];
        },
      },
    });

    const initial = await requestJson("GET", "/portfolio");
    expect(initial.body.snapshot).toBeNull();

    const refreshed = await requestJson("POST", "/portfolio/refresh");
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.snapshot).toMatchObject({
      provider: "alpaca",
      environment: "paper",
      account: { buyingPower: 100000 },
      positions: [{ symbol: "PLTR" }],
    });
    expect(refreshed.body.portfolio.orders).toHaveLength(1);
    expect(refreshed.body.portfolio.storage).toMatchObject({
      persistent: true,
      mode: "paper",
      brokerOrderCount: 1,
      tradeIntentCount: 0,
    });

    const listed = await requestJson("GET", "/portfolio");
    expect(listed.body.snapshots).toHaveLength(1);
    expect(listed.body.brokerOrders).toHaveLength(1);
  });

  it("rejects invalid payloads with 400", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/branches", { description: "missing name" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("bad_request");
  });
});

function makeClient(options: {
  store?: MemoryKairosStore | SupabaseKairosStore;
  runHeartbeat?: LocalApiContext["runHeartbeat"];
  createDebate?: LocalApiContext["createDebate"];
  tradingBroker?: PaperTradingBroker;
  marketSymbolProvider?: LocalApiContext["marketSymbolProvider"];
  notificationSender?: TradingTelegramNotifier;
  telegramBot?: TelegramBotClient;
  supermemoryMirror?: SupermemoryMirror;
  omitLocalRequestHeader?: boolean;
  localApiToken?: string;
  origin?: string;
  headers?: Record<string, string>;
} = {}) {
  const store = options.store ?? new MemoryKairosStore();
  const context: LocalApiContext = {
    store,
    runHeartbeat: options.runHeartbeat ?? (async ({ branchId, payload }) => ({
      output: { branchId, decision: "monitor" },
      events: [
        { type: "heartbeat.seeded", payload },
        { type: "heartbeat.decision", payload: { decision: "monitor" } },
      ],
    })),
    createDebate: options.createDebate ?? (async ({ payload }) => ({
      output: { decision: "needs_review" },
      events: [
        { type: "debate.created", payload },
        { type: "debate.judge.summary", payload: { decision: "needs_review" } },
      ],
    })),
    retrieveUrlContents: async ({ urls }) =>
      urls.map((url, index) => ({
        id: `webpage_${index + 1}`,
        kind: "webpage",
        ref: url,
        text: url,
    })),
    tradingBroker: options.tradingBroker,
    marketSymbolProvider: options.marketSymbolProvider,
    notificationSender: options.notificationSender,
    telegramBot: options.telegramBot,
    supermemoryMirror: options.supermemoryMirror,
    debateCancelStates: new Map<string, { canceled: boolean }>(),
    now: () => new Date("2026-05-03T12:00:00.000Z"),
  };
  const handler = createLocalApiHandler(context);

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return handler(new Request(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.origin ? { origin: options.origin } : {}),
        ...localApiRequestHeaders(options),
        ...options.headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }

  async function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const response = await request(method, path, body);
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    };
  }

  return { request, requestJson };
}

function apiClient(handler: (request: Request) => Promise<Response>) {
  return async function requestJson(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await handler(new Request(`${baseUrl}${path}`, {
      method,
      headers: {
        ...localApiRequestHeaders(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    };
  };
}

function localApiRequestHeaders(options: {
  omitLocalRequestHeader?: boolean;
  localApiToken?: string;
} = {}): Record<string, string> {
  if (options.omitLocalRequestHeader) return {};
  const token = options.localApiToken ?? process.env.KAIROS_LOCAL_API_TOKEN;
  return {
    "x-kairos-local-request": "1",
    ...(token ? { "x-kairos-local-token": token } : {}),
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function createMockMirror(records: SupermemoryMirrorRecord[]): SupermemoryMirror {
  return {
    async mirrorRecord(record) {
      records.push(record);
    },
    async mirrorDebateResult(input) {
      records.push({
        type: "debate_transcript",
        scope: "debate",
        runId: input.runId,
        branchId: input.branchId,
        lawId: input.lawId,
        debateId: input.result.debateId,
        data: input.result,
      });
    },
    async mirrorInformationResult(input) {
      records.push({
        type: "information_result",
        scope: "information",
        runId: input.runId,
        branchId: input.branchId,
        lawId: input.lawId,
        summary: input.result.summary,
        data: input,
      });
    },
  };
}

function tradeIntentPayload(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "PLTR",
    side: "buy",
    notional: 500,
    confidence: 0.9,
    reasoning: "Debate found a material contract catalyst.",
    expectedCatalyst: "New material contract.",
    risk: "Market may have priced in the news.",
    timeHorizon: "1-4 weeks",
    positionSizingRationale: "Small paper order for observation.",
    invalidationCondition: "Contract report is contradicted.",
    exitCondition: "Catalyst is priced in or thesis breaks.",
    ...overrides,
  };
}

function createMockTradingBroker(): PaperTradingBroker {
  return {
    async getPortfolioSnapshot() {
      return {
        id: "portfolio_1",
        capturedAt: "2026-05-03T12:00:00.000Z",
        provider: "alpaca",
        environment: "paper",
        account: {
          status: "ACTIVE",
          cash: 100000,
          buyingPower: 100000,
          portfolioValue: 100000,
          equity: 100000,
          daytradeCount: 0,
        },
        positions: [
          {
            symbol: "PLTR",
            qty: 10,
            marketValue: 250,
            currentPrice: 25,
          },
        ],
      };
    },
    async getClock() {
      return { is_open: true };
    },
    async getAsset() {
      return { tradable: true, status: "active" };
    },
    async submitPaperOrder(input) {
      return {
        id: "broker_order_1",
        createdAt: "2026-05-03T12:00:00.000Z",
        updatedAt: "2026-05-03T12:00:00.000Z",
        provider: "alpaca",
        environment: "paper",
        alpacaOrderId: "alpaca_order_1",
        clientOrderId: input.clientOrderId ?? "kairos_test",
        status: "accepted",
        symbol: input.symbol,
        side: input.side,
        orderType: input.type,
        timeInForce: input.timeInForce,
        qty: input.qty,
        notional: input.notional,
        limitPrice: input.limitPrice,
        submittedAt: "2026-05-03T12:00:00.000Z",
      };
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
