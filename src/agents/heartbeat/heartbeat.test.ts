import { describe, expect, it, vi } from "vitest";

import { createEscalationEvent } from "./escalation.js";
import { getSupermemoryContainerTag } from "./memory.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import { runHeartbeatAgent } from "./agent.js";
import type {
  BranchConfig,
  HeartbeatOutput,
  HeartbeatSeedBundle,
} from "./types.js";

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
});
