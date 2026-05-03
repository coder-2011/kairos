import { describe, expect, it, vi } from "vitest";
import type { HeartbeatRunResult } from "./agent.js";
import {
  createDebateConfigFromEscalation,
  createDebateStartInputFromEscalation,
  runDebateForHeartbeatResult,
  runHeartbeatThenDebate,
} from "./debate-handoff.js";
import { createEscalationEvent } from "./escalation.js";
import type { BranchConfig, HeartbeatOutput, HeartbeatSeedBundle } from "./types.js";

describe("heartbeat debate handoff", () => {
  it("converts an escalation event into a debate config", () => {
    const event = createEscalationEvent(escalatingOutput(), seedBundle());

    expect(event).not.toBeNull();
    const config = createDebateConfigFromEscalation(event!);

    expect(config.debateId).toBe("debate:branch_a:2026-01-02T03:04:05_000Z");
    expect(config.startInput.summary).toContain("Heartbeat escalated branch branch/a.");
    expect(config.startInput.summary).toContain("Unexpected volume and price move.");
    expect(config.startInput.basicFinancials).toMatchObject({
      branchId: "branch/a",
      heartbeatDecision: "escalate",
      heartbeatSummary: "Unexpected volume and price move.",
    });
  });

  it("does not run debate when heartbeat did not escalate", async () => {
    const result: HeartbeatRunResult = {
      output: {
        branch_id: "branch/a",
        timestamp: "2026-01-02T03:04:05.000Z",
        decision: "no_escalation",
        summary: "No material change.",
      },
      seedBundle: seedBundle(),
      escalationEvent: null,
      toolTraces: [],
    };

    await expect(runDebateForHeartbeatResult(result)).resolves.toBeNull();
  });

  it("can run the debate graph from an escalation heartbeat result", async () => {
    const event = createEscalationEvent(escalatingOutput(), seedBundle());
    const result: HeartbeatRunResult = {
      output: escalatingOutput(),
      seedBundle: seedBundle(),
      escalationEvent: event,
      toolTraces: [],
    };

    const debate = await runDebateForHeartbeatResult(result, {
      allowDeterministicFallback: true,
      tools: {
        information: async () => ({
          summary: "Information check completed.",
          citations: [],
        }),
      },
    });

    expect(debate?.status).toBe("completed");
    expect(debate?.debateId).toBe("debate:branch_a:2026-01-02T03:04:05_000Z");
    expect(debate?.messages.length).toBeGreaterThan(0);
  });

  it("runs the smaller heartbeat model result into the multi-agent debate", async () => {
    const information = vi.fn(async () => ({
      summary: "Information check completed for heartbeat escalation.",
      citations: [{ url: "https://example.com/escalation" }],
    }));

    const result = await runHeartbeatThenDebate(
      branchConfig(),
      {
        model: {} as never,
        now: () => new Date("2026-01-02T03:04:05.000Z"),
        seedProviders: {
          getCurrentPrice: async () => ({ AAPL: 100, MSFT: 200 }),
          getNewsHeadlinesAndSummaries: async () => [
            {
              title: "Unexpected volume and price move",
              summary: "Potentially material move.",
              url: "https://example.com/escalation",
            },
          ],
        },
        generateText: vi.fn(async () => ({
          output: escalatingOutput(),
        })),
      },
      {
        allowDeterministicFallback: true,
        tools: {
          information,
        },
      },
    );

    expect(result.heartbeat.output.decision).toBe("escalate");
    expect(result.heartbeat.escalationEvent).not.toBeNull();
    expect(result.debate?.status).toBe("completed");
    expect(result.debate?.debateId).toBe("debate:branch_a:2026-01-02T03:04:05_000Z");
    expect(information).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected volume and price move."),
      expect.objectContaining({
        debateId: "debate:branch_a:2026-01-02T03:04:05_000Z",
      }),
    );
    expect(result.debate?.finalDecision.citations).toEqual([
      { url: "https://example.com/escalation" },
    ]);
  });

  it("keeps the seeded heartbeat bundle available to debate agents", () => {
    const event = createEscalationEvent(escalatingOutput(), seedBundle());
    const input = createDebateStartInputFromEscalation(event!);

    expect(input.basicFinancials.assets).toEqual(["AAPL", "MSFT"]);
    expect(input.basicFinancials.defaultSources).toMatchObject({
      currentPrice: true,
      recentVolume: true,
      tickerMovement: true,
      supermemoryContext: true,
      newsHeadlinesAndSummaries: true,
    });
  });
});

function branchConfig(): BranchConfig {
  return {
    id: "branch/a",
    law: "Watch configured equities for potentially useful developments.",
    assets: ["AAPL", "MSFT"],
    heartbeat: {
      enabled: true,
      intervalMinutes: 5,
      seedWindowDays: 30,
      model: "small-model",
    },
  };
}

function escalatingOutput(): HeartbeatOutput {
  return {
    branch_id: "branch/a",
    timestamp: "2026-01-02T03:04:05.000Z",
    decision: "escalate",
    summary: "Unexpected volume and price move.",
  };
}

function seedBundle(): HeartbeatSeedBundle {
  return {
    branchId: "branch/a",
    timestamp: "2026-01-02T03:04:05.000Z",
    law: "Watch configured equities for potentially useful developments.",
    assets: ["AAPL", "MSFT"],
    seedWindowDays: 30,
    defaultSources: {
      currentPrice: true,
      recentVolume: true,
      tickerMovement: true,
      supermemoryContext: true,
      newsHeadlinesAndSummaries: true,
    },
    priorDecisions: [],
    optionalData: {
      daysUntilEarnings: 12,
    },
  };
}
