import { describe, expect, it, vi } from "vitest";

import { ExaApi } from "../../api/exa.js";
import { FinnhubApi, createFinnhubHeartbeatSeedProviders } from "../../api/finnhub.js";
import { SupermemoryApi } from "../../api/supermemory.js";
import { createEscalationEvent } from "./escalation.js";
import { HeartbeatEscalationDeduper } from "./dedupe.js";
import { getSupermemoryContainerTag } from "./memory.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import { runHeartbeatAgent } from "./agent.js";
import { runHeartbeatOnce } from "./heartbeat.js";
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
    defaultSources: {
      currentPrice: null,
      recentVolume: null,
      tickerMovement: null,
      supermemoryContext: null,
      newsHeadlinesAndSummaries: null,
    },
    optionalData: {},
  };
}

describe("heartbeat seed bundle", () => {
  it("builds the default seed bundle and passes Supermemory scope to providers", async () => {
    const branch = branchConfig();
    const seed = await buildHeartbeatSeedBundle(
      branch,
      {
        getCurrentPrice: vi.fn(async () => ({ PLTR: 100 })),
        getRecentVolume: vi.fn(async () => ({ PLTR: "2x average" })),
        getTickerMovement: vi.fn(async () => ({ PLTR: "+4.2% 1d" })),
        getSupermemoryContext: vi.fn(async (request) => ({
          containerTag: request.supermemoryContainerTag,
          profile: "Prior PLTR deal escalations were useful.",
        })),
        getNewsHeadlinesAndSummaries: vi.fn(async () => [
          {
            title: "PLTR announces new government contract",
            summary: "Potentially material deal headline.",
          },
        ]),
      },
      fixedNow,
    );

    expect(seed).toMatchObject({
      branchId: "pltr enterprise deals",
      timestamp: "2026-05-03T12:00:00.000Z",
      law: branch.law,
      assets: ["PLTR"],
      seedWindowDays: 30,
      defaultSources: {
        currentPrice: { PLTR: 100 },
        recentVolume: { PLTR: "2x average" },
        tickerMovement: { PLTR: "+4.2% 1d" },
        supermemoryContext: {
          containerTag: "branch_pltr_enterprise_deals",
        },
      },
      optionalData: {},
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
});

describe("heartbeat agent", () => {
  it("runs the LangGraph heartbeat workflow and creates escalation events", async () => {
    const fakeModel = {
      withStructuredOutput: vi.fn(() => ({
        invoke: vi.fn(async (): Promise<HeartbeatOutput> => {
          return {
            branch_id: "model-wrong-branch",
            timestamp: "model-wrong-timestamp",
            decision: "escalate",
            summary: "A new PLTR contract headline may be material.",
          };
        }),
      })),
    };

    const result = await runHeartbeatAgent(branchConfig(), {
      model: fakeModel,
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
          model: {
            withStructuredOutput: vi.fn(),
          },
        },
      ),
    ).rejects.toThrow("Heartbeat is disabled");
  });

  it("runs one bounded tool pass before final structured output", async () => {
    const toolInvoke = vi.fn(async () => ({ memories: ["prior false positive"] }));
    const structuredInvoke = vi.fn(async (_input: unknown): Promise<HeartbeatOutput> => ({
      branch_id: "ignored",
      timestamp: "ignored",
      decision: "no_escalation",
      summary: "No useful new event found.",
    }));
    const fakeModel = {
      bindTools: vi.fn(() => ({
        invoke: vi.fn(async () => ({
          tool_calls: [
            {
              id: "call_1",
              name: "supermemory_search",
              args: { query: "PLTR" },
            },
          ],
        })),
      })),
      withStructuredOutput: vi.fn(() => ({
        invoke: structuredInvoke,
      })),
    };

    await runHeartbeatAgent(branchConfig(), {
      model: fakeModel,
      now: () => fixedNow,
      tools: [{ name: "supermemory_search", invoke: toolInvoke }],
    });

    expect(toolInvoke).toHaveBeenCalledWith({ query: "PLTR" });
    expect(structuredInvoke.mock.calls[0]?.[0] as unknown[]).toHaveLength(3);
  });
});

describe("heartbeat de-dupe", () => {
  it("suppresses repeated escalation summaries within the last three heartbeat calls", () => {
    const deduper = new HeartbeatEscalationDeduper(3);
    const escalation: HeartbeatOutput = {
      branch_id: "branch",
      timestamp: "2026-05-03T12:00:00.000Z",
      decision: "escalate",
      summary: "PLTR contract may be material.",
    };

    expect(deduper.suppressDuplicate(escalation).decision).toBe("escalate");
    expect(deduper.suppressDuplicate(escalation).decision).toBe("no_escalation");

    for (let index = 0; index < 3; index += 1) {
      deduper.suppressDuplicate({
        ...escalation,
        decision: "no_escalation",
        summary: `No event ${index}`,
      });
    }

    expect(deduper.suppressDuplicate(escalation).decision).toBe("escalate");
  });

  it("runHeartbeatOnce applies de-dupe before creating escalation events", async () => {
    const deduper = new HeartbeatEscalationDeduper(3);
    const model = {
      withStructuredOutput: vi.fn(() => ({
        invoke: vi.fn(async (): Promise<HeartbeatOutput> => ({
          branch_id: "ignored",
          timestamp: "ignored",
          decision: "escalate",
          summary: "Same event.",
        })),
      })),
    };

    const first = await runHeartbeatOnce(branchConfig(), {
      model,
      now: () => fixedNow,
      deduper,
    });
    const second = await runHeartbeatOnce(branchConfig(), {
      model,
      now: () => fixedNow,
      deduper,
    });

    expect(first.escalationEvent).not.toBeNull();
    expect(second.output.decision).toBe("no_escalation");
    expect(second.escalationEvent).toBeNull();
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
      containerTag: "law_pltr_deals",
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
  });

  it("calls Exa search with compact news highlights", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        results: [
          {
            title: "PLTR news",
            url: "https://example.com",
            highlights: ["market-relevant highlight"],
          },
        ],
      }),
    );
    const api = new ExaApi({
      apiKey: "exa_key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await api.search({ query: "PLTR latest", numResults: 3 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body).toMatchObject({
      query: "PLTR latest",
      type: "auto",
      num_results: 3,
      category: "news",
    });
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
});
