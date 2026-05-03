import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ExaApi,
  FinnhubApi,
  SupermemoryApi,
  createOpenRouterModel,
  validateKairosEnv,
} from "../../api/index.js";
import { createHeartbeatSeedProviders, createHeartbeatTools } from "./index.js";
import { HeartbeatEscalationDeduper } from "./dedupe.js";
import { runHeartbeatOnce } from "./heartbeat.js";
import type { BranchConfig } from "./types.js";

loadDotEnvLocal();

const env = validateKairosEnv();
const describeIfLive =
  process.env.KAIROS_LIVE_TESTS === "1" && env.ok ? describe : describe.skip;

describeIfLive("heartbeat live", () => {
  it("runs the full heartbeat path against live APIs", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kairos-heartbeat-live-"));
    const supermemory = new SupermemoryApi();
    const branch: BranchConfig = {
      id: "live heartbeat smoke",
      name: "Live heartbeat smoke",
      law: [
        "Monitor AAPL for any recent market-relevant catalyst.",
        "Use seeded price, volume, movement, Supermemory, and news context.",
        "Only escalate if the evidence looks genuinely novel, material, or time-sensitive.",
      ].join(" "),
      assets: ["AAPL"],
      heartbeat: {
        enabled: true,
        intervalMinutes: 5,
        seedWindowDays: 30,
        model: process.env.OPENROUTER_HEARTBEAT_MODEL ?? "openai/gpt-4o-mini",
        maxSearchCalls: 2,
        maxMemoryQueries: 2,
      },
      memory: {
        supermemoryContainerTag: "kairos_live_heartbeat_smoke",
      },
    };

    try {
      const result = await runHeartbeatOnce(branch, {
        model: createOpenRouterModel({
          model: branch.heartbeat.model,
        }),
        seedProviders: createHeartbeatSeedProviders({
          finnhub: new FinnhubApi(),
          supermemory,
        }),
        tools: createHeartbeatTools({
          exa: new ExaApi(),
          supermemory,
        }),
        maxToolSteps: 3,
        deduper: new HeartbeatEscalationDeduper(
          3,
          join(tempDir, "heartbeat-dedupe.json"),
        ),
        memoryWriter: supermemory,
      });

      expect(result.output.branch_id).toBe(branch.id);
      expect(result.output.timestamp).toEqual(expect.any(String));
      expect(["escalate", "no_escalation"]).toContain(result.output.decision);
      expect(result.output.summary.length).toBeGreaterThan(0);
      expect(result.seedBundle.defaultSources.currentPrice).toBeTruthy();
      expect(result.seedBundle.defaultSources.recentVolume).toBeTruthy();
      expect(result.seedBundle.defaultSources.tickerMovement).toBeTruthy();
      expect(result.seedBundle.defaultSources.supermemoryContext).toBeTruthy();
      expect(result.seedBundle.defaultSources.newsHeadlinesAndSummaries).toBeTruthy();
      expect(Array.isArray(result.toolTraces)).toBe(true);

      if (result.output.decision === "escalate") {
        expect(result.escalationEvent).toMatchObject({
          branchId: branch.id,
          status: "pending_big_model",
        });
      } else {
        expect(result.escalationEvent).toBeNull();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});

function loadDotEnvLocal(): void {
  if (!existsSync(".env.local")) {
    return;
  }

  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ??= valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}
