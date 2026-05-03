import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  createLocalApi,
  createLocalApiHandler,
  MemoryKairosStore,
  SupabaseKairosStore,
  type LocalApiContext,
} from "./src/server.js";
import type { PaperTradingBroker } from "../../src/trading/index.js";
import type { TradingSmsNotifier } from "../../src/notifications/index.js";
import type { SupermemoryMirror, SupermemoryMirrorRecord } from "../../src/global/index.js";

const baseUrl = "http://kairos.local";

describe("local API handler", () => {
  it("responds to health checks", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "kairos-local-api" });
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

  it("triggers deterministic dry-run heartbeat runs and exposes run events", async () => {
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
      dryRun: true,
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

  it("creates deterministic debate runs from escalation-like payloads", async () => {
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
      dryRun: true,
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
      createDebate: async ({ dryRun, payload }) => {
        debatePayloads.push(payload);
        return {
          output: { decision: "needs_review", dryRun },
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

  it("creates a sell-side paper intent from a sell debate decision when holdings exist", async () => {
    const { requestJson } = makeClient({
      tradingBroker: createMockTradingBroker(),
      createDebate: async ({ dryRun, payload }) => ({
        output: {
          finalDecision: {
            summary: "Bear case says the branch thesis is broken.",
            action: "sell",
            confidence: 0.91,
            citations: [],
          },
          dryRun,
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
      runHeartbeat: async ({ branchId, dryRun, payload }) => {
        heartbeatPayloads.push({ branchId, payload });
        return {
          output: {
            branchId,
            decision: "monitor",
            dryRun,
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
          headers: { "content-type": "application/json" },
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dryRun: false, input: { source: "test" } }),
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
          dryRun: false,
        },
      });
      expect(heartbeatBody.message).toContain("Agent pipeline heartbeat is not configured");
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
        runHeartbeat: async ({ branchId, dryRun, payload }) => ({
          output: { branchId, decision: "monitor", dryRun, summary: "Heartbeat summary" },
          events: [
            { type: "heartbeat.seeded", payload },
            { type: "heartbeat.decision", payload: { decision: "monitor" } },
          ],
        }),
        createDebate: async ({ dryRun, payload }) => ({
          output: {
            decision: "needs_review",
            confidence: 0.7,
            summary: "Debate found a notification-worthy catalyst.",
            dryRun,
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

  it("can use Supabase as the same API store backend", async () => {
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
          const rows = [...records.values()].filter((row) => {
            const record = row.record as { runId?: string };
            return (
              (!collection || row.collection === collection) &&
              (!id || row.id === id) &&
              (!runId || record.runId === runId)
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

    expect(created.status).toBe(201);
    expect(events.body.events.map((event: { type: string }) => event.type)).toEqual([
      "run.started",
      "heartbeat.seeded",
      "heartbeat.decision",
      "run.completed",
    ]);
    expect(requests.some((request) => request.url.includes("/rest/v1/kairos_records"))).toBe(true);
  });

  it("creates a message and paper trade intent when confidence crosses paper threshold without auto-buy", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      confidence: 0.9,
      tradingConfig: {
        mode: "paper",
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
        paperAutoBuyEnabled: false,
      },
    }));

    expect(response.status).toBe(201);
    expect(response.body.policy).toMatchObject({
      thresholdResult: "paper_trade_candidate",
      permittedAction: "paper_trade_intent",
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

  it("sends an SMS notification when confidence crosses the notify threshold", async () => {
    const sent: unknown[] = [];
    const { requestJson } = makeClient({
      notificationSender: {
        async send(input) {
          sent.push(input);
          return {
            body: "PLTR alert 90%",
            provider: "twilio",
            sid: "SM_test",
            status: "queued",
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
      "sms_notification_sent",
    ]);
  });

  it("preflights and submits an Alpaca paper order when paper auto-buy is enabled", async () => {
    const { requestJson } = makeClient({ tradingBroker: createMockTradingBroker() });

    const response = await requestJson("POST", "/trade-intents", tradeIntentPayload({
      confidence: 0.91,
      tradingConfig: {
        mode: "paper",
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
        paperAutoBuyEnabled: true,
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

  it("refreshes and persists portfolio snapshots through the trading broker", async () => {
    const { requestJson } = makeClient({ tradingBroker: createMockTradingBroker() });

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

    const listed = await requestJson("GET", "/portfolio");
    expect(listed.body.snapshots).toHaveLength(1);
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
  notificationSender?: TradingSmsNotifier;
  supermemoryMirror?: SupermemoryMirror;
} = {}) {
  const store = options.store ?? new MemoryKairosStore();
  const context: LocalApiContext = {
    store,
    runHeartbeat: options.runHeartbeat ?? (async ({ branchId, dryRun, payload }) => ({
      output: { branchId, decision: "monitor", dryRun },
      events: [
        { type: "heartbeat.seeded", payload },
        { type: "heartbeat.decision", payload: { decision: "monitor" } },
      ],
    })),
    createDebate: options.createDebate ?? (async ({ dryRun, payload }) => ({
      output: { decision: "needs_review", dryRun },
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
    notificationSender: options.notificationSender,
    supermemoryMirror: options.supermemoryMirror,
  };
  const handler = createLocalApiHandler(context);

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return handler(new Request(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
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
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    };
  };
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
