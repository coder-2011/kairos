import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ExaApi,
  FinnhubApi,
  SupermemoryApi,
  createAlpacaTradingClient,
  createOpenRouterAiSdkModelForRole,
  createOpenRouterChatModelForRole,
  resolveKairosModelConfig,
  validateKairosEnv,
} from "../../api/index.js";
import { createInformationDebateTool } from "../information/tool.js";
import { resolveDebatePrompts } from "../debate/prompt.js";
import {
  createHeartbeatSeedProviders,
  createHeartbeatTools,
  runHeartbeatThenDebate,
} from "./index.js";
import { buildHeartbeatUserMessage, resolveHeartbeatPrompts } from "./prompt.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import type { BranchConfig } from "./types.js";

loadDotEnvLocal();

const env = validateKairosEnv();
const describeIfLive =
  process.env.KAIROS_LIVE_TESTS === "1" && env.ok ? describe : describe.skip;

describeIfLive("heartbeat full live pipeline", () => {
  it(
    "writes and reads input context, packages live seed data, runs heartbeat, and hands off to debate when escalated",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "kairos-full-pipeline-live-"));
      const runId = `kairos_pipeline_probe_${Date.now()}`;
      const containerTag = "kairos_live_full_pipeline";
      const supermemory = new SupermemoryApi();
      const exa = new ExaApi();
      const finnhub = new FinnhubApi();
      const branch = branchConfig(containerTag);

      try {
        const memoryContent = [
          `Pipeline probe ${runId}.`,
          "Human context: for this test branch, an unusual live PLTR headline or strong price/volume/news signal should escalate to debate.",
          "False positive rule: generic market commentary without a company-specific catalyst should not escalate.",
        ].join(" ");

        const memoryWrite = await supermemory.createMemories({
          containerTag,
          memories: [
            {
              content: memoryContent,
              isStatic: false,
              metadata: {
                type: "pipeline_probe",
                run_id: runId,
              },
            },
          ],
        });
        const memoryRead = await waitForSupermemorySearch({
          supermemory,
          containerTag,
          query: runId,
        });

        const seedProviders = createHeartbeatSeedProviders({
          alpaca: createAlpacaTradingClient(),
          finnhub,
          supermemory,
        });
        const seedBundle = await buildHeartbeatSeedBundle(
          branch,
          seedProviders,
          new Date(),
        );
        const inputPackage = buildHeartbeatUserMessage(seedBundle);
        const parsedInputPackage = JSON.parse(inputPackage) as {
          package_type: string;
          seed_bundle: unknown;
        };

        console.info(
          JSON.stringify(
            {
              stage: "heartbeat_input_package",
              packageType: parsedInputPackage.package_type,
              branchId: seedBundle.branchId,
              assets: seedBundle.assets,
              seedWindowDays: seedBundle.seedWindowDays,
              defaultSourceKeys: Object.keys(seedBundle.defaultSources),
              inputPackagePreview: inputPackage.slice(0, 1600),
            },
            null,
            2,
          ),
        );

        const judgeModel = createOpenRouterChatModelForRole("debateJudge", {
          temperature: 0,
        }) as never;
        const bullModel = createOpenRouterChatModelForRole("debateBull", {
          temperature: 0,
        }) as never;
        const bearModel = createOpenRouterChatModelForRole("debateBear", {
          temperature: 0,
        }) as never;
        const finalModel = createOpenRouterChatModelForRole("debateFinal", {
          temperature: 0,
        }) as never;
        const informationPlannerModel = createOpenRouterChatModelForRole(
          "informationPlanner",
          { temperature: 0 },
        ) as never;
        const informationSynthesisModel = createOpenRouterChatModelForRole(
          "informationSynthesis",
          { temperature: 0 },
        ) as never;
        const result = await runHeartbeatThenDebate(
          branch,
          {
            model: createOpenRouterAiSdkModelForRole("heartbeat", {
              temperature: 0,
            }),
            seedProviders,
            tools: createHeartbeatTools({
              exa,
              supermemory,
            }),
            maxToolSteps: 3,
            prompts: resolveHeartbeatPrompts(),
            memoryWriter: supermemory,
          },
          {
            models: {
              judge: judgeModel,
              bull: bullModel,
              bear: bearModel,
              final: finalModel,
            },
            tools: {
              information: createInformationDebateTool({
                plannerModel: informationPlannerModel,
                synthesisModel: informationSynthesisModel,
                exa,
                finnhub,
                supermemory,
                supermemoryContainerTag: containerTag,
              }),
            },
            prompts: resolveDebatePrompts(),
          },
          {
            budgets: {
              maxTurns: 3,
              maxToolCalls: 2,
            },
            humanInterjections: [
              {
                timestamp: new Date().toISOString(),
                summary:
                  "Live pipeline test context: prefer cited sources and be skeptical of generic headlines.",
              },
            ],
          },
        );

        console.info(
          JSON.stringify(
            {
              stage: "heartbeat_output",
              output: result.heartbeat.output,
              toolTraceCount: result.heartbeat.toolTraces.length,
              escalated: Boolean(result.heartbeat.escalationEvent),
              debate: result.debate
                ? {
                    status: result.debate.status,
                    debateId: result.debate.debateId,
                    messageCount: result.debate.messages.length,
                    toolEventCount: result.debate.toolEvents.length,
                    finalDecision: result.debate.finalDecision,
                  }
                : null,
            },
            null,
            2,
          ),
        );

        expect(memoryWrite.memories[0]?.memory).toContain(runId);
        expect(memoryRead.results.some((item) => item.memory.includes(runId))).toBe(
          true,
        );
        expect(parsedInputPackage.package_type).toBe("heartbeat_seed_bundle_v1");
        expect(parsedInputPackage.seed_bundle).toEqual(seedBundle);
        expect(seedBundle.defaultSources.currentPrice).toBeTruthy();
        expect(seedBundle.defaultSources.recentVolume).toBeTruthy();
        expect(seedBundle.defaultSources.tickerMovement).toBeTruthy();
        expect(seedBundle.defaultSources.supermemoryContext).toBeTruthy();
        expect(seedBundle.defaultSources.newsHeadlinesAndSummaries).toBeTruthy();
        expect(result.heartbeat.output.branch_id).toBe(branch.id);
        expect(result.heartbeat.output.summary.length).toBeGreaterThan(0);
        expect(["escalate", "no_escalation"]).toContain(
          result.heartbeat.output.decision,
        );

        if (result.heartbeat.output.decision === "escalate") {
          expect(result.debate?.status).toBe("completed");
          expect(result.debate?.finalDecision.summary.length).toBeGreaterThan(20);
        } else {
          expect(result.debate).toBeNull();
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

function branchConfig(containerTag: string): BranchConfig {
  return {
    id: "live full pipeline heartbeat debate",
    name: "Live full pipeline heartbeat debate",
    law: [
      "Monitor PLTR for company-specific catalysts using the live seed bundle.",
      "Escalate when the package contains a recent source-checkable headline, memory context, or price/volume/news signal that appears useful for a multi-agent debate.",
      "Do not escalate for generic market commentary or stale duplicate context.",
    ].join(" "),
    assets: ["PLTR"],
    heartbeat: {
      enabled: true,
      intervalMinutes: 5,
      seedWindowDays: 30,
      model: resolveKairosModelConfig("heartbeat").model,
      maxSearchCalls: 2,
      maxMemoryQueries: 2,
    },
    memory: {
      supermemoryContainerTag: containerTag,
    },
  };
}

async function waitForSupermemorySearch(input: {
  supermemory: SupermemoryApi;
  containerTag: string;
  query: string;
}) {
  const deadline = Date.now() + 60_000;
  let lastResult = await input.supermemory.search({
    q: input.query,
    containerTag: input.containerTag,
    limit: 5,
    searchMode: "memories",
    rerank: true,
  });

  while (
    Date.now() < deadline &&
    !lastResult.results.some((item) => item.memory.includes(input.query))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    lastResult = await input.supermemory.search({
      q: input.query,
      containerTag: input.containerTag,
      limit: 5,
      searchMode: "memories",
      rerank: true,
    });
  }

  return lastResult;
}

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
