import { describe, expect, it, vi } from "vitest";

import { ExaApi } from "../../api/exa.js";
import { FinnhubApi, createFinnhubHeartbeatSeedProviders } from "../../api/finnhub.js";
import { SupermemoryApi } from "../../api/supermemory.js";
import { validateKairosEnv } from "../../global/env.js";
import { createEscalationEvent } from "./escalation.js";
import {
  getSupermemoryContainerTag,
  getSupermemoryProfileContainerTag,
} from "./memory.js";
import { resolveHeartbeatPrompts } from "./prompt.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import { runHeartbeatAgent } from "./agent.js";
import { runHeartbeatOnce, startHeartbeatScheduler } from "./heartbeat.js";
import type {
  BranchConfig,
  HeartbeatOutput,
  HeartbeatSeedBundle,
} from "./types.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function branchConfig(overrides: Partial<BranchConfig> = {}): BranchConfig {
  return {
    id: "pltr enterprise deals",
    name: "PLTR enterprise deals",
    law: "Escalate if PLTR signs a potentially material government or enterprise deal.",
    assets: ["PLTR"],
    heartbeat: {
      enabled: true,
      intervalMinutes: 5,
      seedWindowDays: 30,
      model: "openrouter/qwen-9b",
    },
    ...overrides,
  };
}

const fixedNow = new Date("2026-05-03T12:00:00.000Z");

function emptySeedBundle(output: HeartbeatOutput): HeartbeatSeedBundle {
  return {
    branchId: output.branch_id,
    timestamp: output.timestamp,
    law: "law",
    assets: ["PLTR"],
    seedWindowDays: 30,
    supermemoryContainerTag: "branch_branch",
    supermemoryProfileContainerTag: "branch_profile_branch",
    defaultSources: {
      currentPrice: null,
      recentVolume: null,
      tickerMovement: null,
      supermemoryContext: null,
      newsHeadlinesAndSummaries: null,
    },
    priorDecisions: [],
    optionalData: {},
  };
}

describe("heartbeat seed bundle", () => {
  it("builds the default seed bundle and passes branch Supermemory profile scope to providers", async () => {
    const branch = branchConfig();
    const getSupermemoryContext = vi.fn(async (request) => ({
      rawContainerTag: request.supermemoryContainerTag,
      profileContainerTag: request.supermemoryProfileContainerTag,
      profile: "Prior PLTR deal escalations were useful.",
    }));
    const getPriorDecisions = vi.fn(async (request) => [
      {
        id: "prior_1",
        memory:
          `Prior decision loaded from ${request.supermemoryProfileContainerTag}: generic PLTR commentary was not useful.`,
        similarity: 0.8,
        updatedAt: "2026-05-02T12:00:00.000Z",
        metadata: {
          type: "heartbeat_output",
        },
      },
    ]);
    const seed = await buildHeartbeatSeedBundle(
      branch,
      {
        getCurrentPrice: vi.fn(async () => ({ PLTR: 100 })),
        getRecentVolume: vi.fn(async () => ({ PLTR: "2x average" })),
        getTickerMovement: vi.fn(async () => ({ PLTR: "+4.2% 1d" })),
        getSupermemoryContext,
        getNewsHeadlinesAndSummaries: vi.fn(async () => [
          {
            title: "PLTR announces new government contract",
            summary: "Potentially material deal headline.",
          },
        ]),
        getPriorDecisions,
      },
      fixedNow,
    );

    expect(seed).toMatchObject({
      branchId: "pltr enterprise deals",
      timestamp: "2026-05-03T12:00:00.000Z",
      law: branch.law,
      assets: ["PLTR"],
      seedWindowDays: 30,
      supermemoryContainerTag: "branch_pltr_enterprise_deals",
      supermemoryProfileContainerTag: "branch_profile_pltr_enterprise_deals",
      defaultSources: {
        currentPrice: { PLTR: 100 },
        recentVolume: { PLTR: "2x average" },
        tickerMovement: { PLTR: "+4.2% 1d" },
        supermemoryContext: {
          rawContainerTag: "branch_pltr_enterprise_deals",
          profileContainerTag: "branch_profile_pltr_enterprise_deals",
        },
      },
      priorDecisions: [
        {
          id: "prior_1",
          memory:
            "Prior decision loaded from branch_profile_pltr_enterprise_deals: generic PLTR commentary was not useful.",
        },
      ],
      optionalData: {},
    });
    expect(getSupermemoryContext.mock.calls[0]?.[0]).toMatchObject({
      supermemoryContainerTag: "branch_pltr_enterprise_deals",
      supermemoryProfileContainerTag: "branch_profile_pltr_enterprise_deals",
    });
    expect(getPriorDecisions.mock.calls[0]?.[0]).toMatchObject({
      supermemoryContainerTag: "branch_pltr_enterprise_deals",
      supermemoryProfileContainerTag: "branch_profile_pltr_enterprise_deals",
    });
  });

  it("keeps optional seeded data generic and only fetches enabled source keys", async () => {
    const getOptionalData = vi.fn(async ({ sourceKey }) => `${sourceKey}-data`);
    const seed = await buildHeartbeatSeedBundle(
      branchConfig({
        seededData: {
          optionalSources: {
            earnings: true,
            secFilings: false,
            insiderActivity: true,
          },
        },
      }),
      { getOptionalData },
      fixedNow,
    );

    expect(seed.optionalData).toEqual({
      earnings: "earnings-data",
      insiderActivity: "insiderActivity-data",
    });
    expect(getOptionalData).toHaveBeenCalledTimes(2);
  });
});

describe("Supermemory container tags", () => {
  it("uses configured container tags when present", () => {
    expect(
      getSupermemoryContainerTag(
        branchConfig({
          memory: {
            supermemoryContainerTag: "law_pltr_deals",
          },
        }),
      ),
    ).toBe("law_pltr_deals");
  });

  it("derives valid branch-scoped container tags from branch IDs", () => {
    expect(getSupermemoryContainerTag(branchConfig())).toBe(
      "branch_pltr_enterprise_deals",
    );
  });

  it("derives separate branch-scoped user profile tags from branch IDs", () => {
    expect(getSupermemoryProfileContainerTag(branchConfig())).toBe(
      "branch_profile_pltr_enterprise_deals",
    );
  });

  it("uses configured branch profile tags when present", () => {
    expect(
      getSupermemoryProfileContainerTag(
        branchConfig({
          memory: {
            supermemoryContainerTag: "raw_branch_pltr_deals",
            supermemoryProfileContainerTag: "profile_branch_pltr_deals",
          },
        }),
      ),
    ).toBe("profile_branch_pltr_deals");
  });
});

describe("heartbeat agent", () => {
  it("runs the AI SDK heartbeat loop and creates escalation events", async () => {
    const generateText = vi.fn(async () => ({
      output: {
        branch_id: "model-wrong-branch",
        timestamp: "model-wrong-timestamp",
        decision: "escalate",
        summary: "A new PLTR contract headline may be material.",
      },
    }));

    const result = await runHeartbeatAgent(branchConfig(), {
      model: {} as never,
      generateText,
      now: () => fixedNow,
      seedProviders: {
        getCurrentPrice: async () => ({ PLTR: 100 }),
      },
    });

    expect(result.output).toEqual({
      branch_id: "pltr enterprise deals",
      timestamp: "2026-05-03T12:00:00.000Z",
      decision: "escalate",
      summary: "A new PLTR contract headline may be material.",
    });
    expect(result.escalationEvent).toMatchObject({
      branchId: "pltr enterprise deals",
      timestamp: "2026-05-03T12:00:00.000Z",
      status: "pending_big_model",
      heartbeatOutput: result.output,
      seedBundle: result.seedBundle,
    });
  });

  it("uses a configured heartbeat system prompt when provided", async () => {
    const generateText = vi.fn(async () => ({
      output: {
        branch_id: "ignored",
        timestamp: "ignored",
        decision: "no_escalation",
        summary: "No useful new event found.",
      },
    }));

    await runHeartbeatAgent(branchConfig(), {
      model: {} as never,
      generateText,
      now: () => fixedNow,
      prompts: {
        systemPrompt: "CUSTOM HEARTBEAT SYSTEM",
      },
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "CUSTOM HEARTBEAT SYSTEM",
      }),
    );
  });

  it("resolves configurable heartbeat system prompts from the environment", () => {
    expect(
      resolveHeartbeatPrompts({
        KAIROS_HEARTBEAT_SYSTEM_PROMPT: "ENV HEARTBEAT",
      }),
    ).toEqual({
      systemPrompt: "ENV HEARTBEAT",
    });
    expect(resolveHeartbeatPrompts({})).toBeUndefined();
  });

  it("does not create escalation events for no-escalation output", () => {
    const output: HeartbeatOutput = {
      branch_id: "pltr-enterprise-deals",
      timestamp: "2026-05-03T12:00:00.000Z",
      decision: "no_escalation",
      summary: "No useful new event found.",
    };

    expect(
      createEscalationEvent(output, emptySeedBundle(output)),
    ).toBeNull();
  });

  it("refuses to run disabled heartbeat branches", async () => {
    await expect(
      runHeartbeatAgent(
        branchConfig({
      heartbeat: {
            enabled: false,
            intervalMinutes: 5,
            seedWindowDays: 30,
            model: "openrouter/qwen-9b",
          },
        }),
        {
          model: {} as never,
          generateText: vi.fn(),
        },
      ),
    ).rejects.toThrow("Heartbeat is disabled");
  });

  it("passes tools and a bounded step count to the AI SDK", async () => {
    const generateText = vi.fn(async (): Promise<{ output: HeartbeatOutput }> => ({
      output: {
        branch_id: "ignored",
        timestamp: "ignored",
        decision: "no_escalation",
        summary: "No useful new event found.",
      },
    }));
    const tools = {
      supermemory_search: {
        description: "Search memory",
        inputSchema: {} as never,
        execute: vi.fn(),
      },
    };

    await runHeartbeatAgent(branchConfig(), {
      model: {} as never,
      generateText,
      now: () => fixedNow,
      tools,
      maxToolSteps: 4,
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {},
        system: expect.any(String),
        prompt: expect.any(String),
        tools,
      }),
    );
  });

  it("extracts AI SDK tool traces from model steps", async () => {
    const generateText = vi.fn(async () => ({
      output: {
        branch_id: "ignored",
        timestamp: "ignored",
        decision: "no_escalation",
        summary: "No useful new event found.",
      },
      steps: [
        {
          toolCalls: [
            {
              toolCallId: "call_1",
              toolName: "exa_news_search",
              input: { query: "PLTR" },
            },
          ],
          toolResults: [
            {
              toolCallId: "call_1",
              toolName: "exa_news_search",
              output: { results: [{ title: "PLTR headline" }] },
            },
          ],
        },
      ],
    }));

    const result = await runHeartbeatAgent(branchConfig(), {
      model: {} as never,
      generateText,
      now: () => fixedNow,
    });

    expect(result.toolTraces).toEqual([
      {
        branchId: "pltr enterprise deals",
        timestamp: "2026-05-03T12:00:00.000Z",
        toolName: "exa_news_search",
        input: { query: "PLTR" },
        output: { results: [{ title: "PLTR headline" }] },
        error: undefined,
      },
    ]);
  });
});

describe("heartbeat scheduler", () => {
  it("runs heartbeat branches on a simple interval and can be stopped", async () => {
    vi.useFakeTimers();

    const generateText = vi.fn(async (): Promise<{ output: HeartbeatOutput }> => ({
        output: {
          branch_id: "ignored",
          timestamp: "ignored",
          decision: "no_escalation",
          summary: "No useful new event found.",
        },
      }));
    const onResult = vi.fn();
    const scheduler = startHeartbeatScheduler(
      branchConfig({
        heartbeat: {
          enabled: true,
          intervalMinutes: 1,
          seedWindowDays: 30,
          model: "openrouter/qwen-9b",
        },
      }),
      {
        model: {} as never,
        generateText,
        now: () => fixedNow,
        onResult,
      },
    );

    try {
      await scheduler.runNow();
      expect(onResult).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(onResult).toHaveBeenCalledTimes(2);

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onResult).toHaveBeenCalledTimes(2);
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });
});

describe("heartbeat de-dupe", () => {
  it("passes prior branch decisions into the model prompt for semantic duplicate suppression", async () => {
    const generateText = vi.fn(async (): Promise<{ output: HeartbeatOutput }> => ({
        output: {
          branch_id: "ignored",
          timestamp: "ignored",
          decision: "no_escalation",
          summary: "Prior memory already covered this catalyst.",
        },
      }));

    const result = await runHeartbeatOnce(branchConfig(), {
      model: {} as never,
      generateText,
      now: () => fixedNow,
      seedProviders: {
        getPriorDecisions: async () => [
          {
            id: "memory_prior_1",
            memory:
              "Heartbeat already processed the PLTR contract catalyst yesterday and did not need another escalation.",
            similarity: 0.91,
          },
        ],
      },
    });

    expect(result.escalationEvent).toBeNull();
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("memory_prior_1"),
      }),
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("already processed the PLTR contract catalyst"),
      }),
    );
  });

  it("runHeartbeatOnce persists tool traces through the memory writer", async () => {
    const writeToolTraces = vi.fn();
    const result = await runHeartbeatOnce(branchConfig(), {
      model: {} as never,
      generateText: vi.fn(async () => ({
        output: {
          branch_id: "ignored",
          timestamp: "ignored",
          decision: "no_escalation",
          summary: "No useful new event found.",
        },
        steps: [
          {
            toolResults: [
              {
                toolName: "supermemory_search",
                output: { results: [] },
              },
            ],
          },
        ],
      })),
      now: () => fixedNow,
      memoryWriter: {
        writeToolTraces,
      },
    });

    expect(result.toolTraces).toHaveLength(1);
    expect(writeToolTraces).toHaveBeenCalledWith({
      containerTag: "branch_profile_pltr_enterprise_deals",
      traces: result.toolTraces,
    });
  });

});

describe("API clients", () => {
  it("calls Supermemory profile/search endpoints with bearer auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v4/profile")) {
        return jsonResponse({
          profile: { static: ["stable"], dynamic: ["recent"] },
          searchResults: { results: [], total: 0 },
        });
      }

      return jsonResponse({ results: [{ id: "mem", memory: "fact", similarity: 0.9 }] });
    });

    const api = new SupermemoryApi({
      apiKey: "sm_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await api.getHeartbeatContext({
      containerTag: "branch_profile_pltr_deals",
      query: "PLTR deals",
    });

    expect(result.profile.static).toEqual(["stable"]);
    expect(result.search.results[0]?.memory).toBe("fact");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer sm_key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      containerTag: "branch_profile_pltr_deals",
      q: "PLTR deals",
    });
  });

  it("writes heartbeat outputs, escalations, conversations, and direct memories to Supermemory", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v3/documents")) {
        return jsonResponse({ id: "doc_123", status: "queued" });
      }
      return jsonResponse({
        documentId: "doc_mem",
        memories: [
          {
            id: "mem_1",
            memory: "stored",
            isStatic: false,
            createdAt: "2026-05-03T12:00:00.000Z",
          },
        ],
      });
    });
    const api = new SupermemoryApi({
      apiKey: "sm_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const output: HeartbeatOutput = {
      branch_id: "branch",
      timestamp: "2026-05-03T12:00:00.000Z",
      decision: "escalate",
      summary: "A useful thing happened.",
    };
    const seedBundle = emptySeedBundle(output);
    const event = createEscalationEvent(output, seedBundle);
    const expectedEscalationCustomId =
      `heartbeat-escalation:${event!.branchId}:${event!.timestamp}`.replace(
        /[^a-zA-Z0-9_:-]/g,
        "_",
      );

    await api.writeHeartbeatOutput({
      containerTag: "law_branch",
      output,
      seedBundle,
    });
    await api.createMemories({
      containerTag: "law_branch",
      memories: [{ content: "Manual branch memory", isStatic: true }],
    });
    await api.writeEscalationEvent({
      containerTag: "law_branch",
      event: event!,
    });
    await api.writeConversation({
      containerTag: "law_branch",
      customId: "conversation_1",
      messages: [{ role: "user", content: "Watch PLTR deals." }],
    });
    await api.writeToolTraces({
      containerTag: "law_branch",
      traces: [
        {
          branchId: "branch",
          timestamp: "2026-05-03T12:00:00.000Z",
          toolName: "exa_news_search",
          input: { query: "PLTR" },
          output: { results: [] },
        },
      ],
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method,
      body: JSON.parse(String(init?.body)),
    }));

    expect(calls).toMatchObject([
      {
        url: "https://api.supermemory.ai/v4/memories",
        method: "POST",
        body: {
          containerTag: "law_branch",
          memories: [
            {
              isStatic: false,
              metadata: {
                type: "heartbeat_output",
                branch_id: "branch",
                decision: "escalate",
              },
            },
          ],
        },
      },
      {
        url: "https://api.supermemory.ai/v4/memories",
        method: "POST",
        body: {
          containerTag: "law_branch",
          memories: [{ content: "Manual branch memory", isStatic: true }],
        },
      },
      {
        url: "https://api.supermemory.ai/v3/documents",
        method: "POST",
        body: {
          containerTag: "law_branch",
          customId: expectedEscalationCustomId,
          metadata: {
            type: "heartbeat_escalation",
            branch_id: "branch",
          },
        },
      },
      {
        url: "https://api.supermemory.ai/v3/documents",
        method: "POST",
        body: {
          containerTag: "law_branch",
          customId: "conversation_1",
          content: "user: Watch PLTR deals.",
          metadata: {
            type: "conversation",
            message_count: 1,
          },
        },
      },
      {
        url: "https://api.supermemory.ai/v4/memories",
        method: "POST",
        body: {
          containerTag: "law_branch",
          memories: [
            {
              content: "Heartbeat tool exa_news_search for branch branch completed",
              isStatic: false,
              metadata: {
                type: "heartbeat_tool_trace",
                branch_id: "branch",
                tool_name: "exa_news_search",
                failed: false,
              },
            },
          ],
        },
      },
    ]);
  });

  it("retries retryable Supermemory responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const api = new SupermemoryApi({
      apiKey: "sm_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryAttempts: 2,
    });

    await expect(api.search({ q: "PLTR" })).resolves.toEqual({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("validates required API keys centrally", () => {
    expect(validateKairosEnv({} as NodeJS.ProcessEnv)).toEqual({
      ok: false,
      missing: [
        "OPENROUTER_API_KEY",
        "SUPERMEMORY_API_KEY",
        "EXA_API_KEY",
        "FINNHUB_API_KEY",
      ],
    });
    expect(
      validateKairosEnv({
        OPENROUTER_API_KEY: "or",
        SUPERMEMORY_API_KEY: "sm",
      } as NodeJS.ProcessEnv, {
        requireModel: true,
        requireMemory: true,
        requireSearch: false,
        requireMarketData: false,
      }),
    ).toEqual({ ok: true, missing: [] });
  });

  it("calls Exa SDK search with compact news highlights", async () => {
    const search = vi.fn(async () => ({
        results: [
          {
            title: "PLTR news",
            url: "https://example.com",
            highlights: ["market-relevant highlight"],
          },
        ],
    }));
    const api = new ExaApi({
      client: {
        search,
        getContents: vi.fn(),
      },
    });

    const result = await api.search({ query: "PLTR latest", numResults: 3 });

    expect(search).toHaveBeenCalledWith("PLTR latest", expect.objectContaining({
      type: "auto",
      numResults: 3,
      category: "news",
    }));
    expect(result.results[0]?.summary).toBe("market-relevant highlight");
  });

  it("uses Finnhub for quote, candles, and company news seed providers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/quote")) {
        return jsonResponse({ c: 100, d: 2, dp: 2, pc: 98 });
      }
      if (url.pathname.endsWith("/stock/candle")) {
        return jsonResponse({ s: "ok", c: [90, 100], v: [10, 20], t: [1, 2] });
      }
      return jsonResponse([
        {
          datetime: 1777771200,
          headline: "PLTR headline",
          summary: "PLTR summary",
          source: "Wire",
          url: "https://example.com",
        },
      ]);
    });
    const finnhub = new FinnhubApi({
      apiKey: "fh_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const providers = createFinnhubHeartbeatSeedProviders(finnhub);
    const branch = branchConfig({ id: "pltr", assets: ["PLTR"] });

    const seed = await buildHeartbeatSeedBundle(branch, providers, fixedNow);

    expect(seed.defaultSources.currentPrice).toMatchObject({
      PLTR: { c: 100 },
    });
    expect(seed.defaultSources.recentVolume).toMatchObject({
      PLTR: { latest: 20, average: 15 },
    });
    expect(seed.defaultSources.newsHeadlinesAndSummaries).toMatchObject([
      {
        title: "PLTR headline",
        summary: "PLTR summary",
        source: "Wire",
      },
    ]);
  });

  it("does not report Finnhub candle provider failures as no-data seed context", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/quote")) {
        return jsonResponse({ c: 100, d: 2, dp: 2, pc: 98 });
      }
      if (url.pathname.endsWith("/stock/candle")) {
        throw new Error("network unavailable");
      }
      return jsonResponse([]);
    });
    const finnhub = new FinnhubApi({
      apiKey: "fh_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryAttempts: 1,
    });
    const providers = createFinnhubHeartbeatSeedProviders(finnhub);
    const branch = branchConfig({ id: "pltr", assets: ["PLTR"] });

    await expect(
      buildHeartbeatSeedBundle(branch, providers, fixedNow),
    ).rejects.toThrow("Finnhub stock candle request failed for PLTR");
  });

  it("rejects unknown optional Finnhub seed source keys", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/quote")) {
        return jsonResponse({ c: 100, d: 2, dp: 2, pc: 98 });
      }
      if (url.pathname.endsWith("/stock/candle")) {
        return jsonResponse({ s: "ok", c: [90, 100], v: [10, 20], t: [1, 2] });
      }
      return jsonResponse([]);
    });
    const finnhub = new FinnhubApi({
      apiKey: "fh_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryAttempts: 1,
    });
    const providers = createFinnhubHeartbeatSeedProviders(finnhub);
    const branch = branchConfig({
      id: "pltr",
      assets: ["PLTR"],
      seededData: {
        optionalSources: {
          definitelyNotARealFinnhubSource: true,
        },
      },
    });

    await expect(
      buildHeartbeatSeedBundle(branch, providers, fixedNow),
    ).rejects.toThrow(
      'Unknown Finnhub optional seed source "definitelyNotARealFinnhubSource".',
    );
  });
});
