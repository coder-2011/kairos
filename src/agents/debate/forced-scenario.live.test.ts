import { describe, expect, it } from "vitest";

import { ExaApi } from "../../api/exa.js";
import { FinnhubApi } from "../../api/finnhub.js";
import { createOpenRouterChatModelForRole } from "../../api/index.js";
import { SupermemoryApi } from "../../api/supermemory.js";
import { createInformationDebateTool } from "../information/tool.js";
import { runDebateAgent } from "./agent.js";
import type { DebateTool, StructuredDebateModelProvider } from "./types.js";

const liveTestsEnabled =
  process.env.KAIROS_LIVE_TESTS === "1" &&
  Boolean(process.env.OPENROUTER_API_KEY) &&
  Boolean(process.env.EXA_API_KEY) &&
  Boolean(process.env.FINNHUB_API_KEY) &&
  Boolean(process.env.SUPERMEMORY_API_KEY);

const liveIt = liveTestsEnabled ? it : it.skip;

function liveModel(
  role: Parameters<typeof createOpenRouterChatModelForRole>[0],
): StructuredDebateModelProvider {
  return createOpenRouterChatModelForRole(role, {
    temperature: 0,
  }) as StructuredDebateModelProvider;
}

describe("forced researched debate scenario", () => {
  liveIt(
    "debates a researched AI infrastructure risk event",
    async () => {
      const exa = new ExaApi();
      const finnhub = new FinnhubApi();
      const supermemory = new SupermemoryApi();
      const judgeModel = liveModel("debateJudge");
      const bullModel = liveModel("debateBull");
      const bearModel = liveModel("debateBear");
      const finalModel = liveModel("debateFinal");
      const informationPlannerModel = liveModel("informationPlanner");
      const informationSynthesisModel = liveModel("informationSynthesis");

      const informationTool: DebateTool = createInformationDebateTool({
        plannerModel: informationPlannerModel,
        synthesisModel: informationSynthesisModel,
        exa,
        finnhub,
        supermemory,
        supermemoryContainerTag: "system_global",
      });

      const result = await runDebateAgent(
        {
          debateId: `forced-coreweave-risk-${Date.now()}`,
          startInput: {
            summary: [
              "Forced escalation test from online research.",
              "Potential problem: CoreWeave (CRWV) and AI infrastructure suppliers sold off after reports that OpenAI missed internal user and revenue targets.",
              "The concern is that slower OpenAI growth could pressure future compute-contract funding and raise questions about whether AI data-center capex is sustainable.",
              "Reuters/Investing.com reported on 2026-04-28 that CoreWeave was down on this concern, with additional pressure from heavy 2026 capex guidance and insider selling.",
              "Run the bull/bear debate as if this was escalated by the smaller heartbeat model.",
            ].join(" "),
            basicFinancials: {
              ticker: "CRWV",
              assets: ["CRWV", "ORCL", "NVDA"],
              sourceUrls: [
                "https://uk.investing.com/news/company-news/why-is-coreweave-stock-sliding-today-93CH-4634004",
                "https://ca.investing.com/news/stock-market-news/nasdaq-sp-500-fall-on-renewed-ai-growth-worries-ahead-of-big-tech-earnings-4592716",
              ],
              escalationReason:
                "Possible customer concentration and funding-risk issue for AI infrastructure capex.",
            },
          },
          humanInterjections: [
            {
              timestamp: new Date().toISOString(),
              summary:
                "Human context: treat this as a stress test, not a trade recommendation. Prefer evidence on customer concentration, capex commitments, and whether the selloff is already priced in.",
            },
          ],
          budgets: {
            maxTurns: 4,
            maxToolCalls: 3,
          },
        },
        {
          models: {
            judge: judgeModel,
            bull: bullModel,
            bear: bearModel,
            final: finalModel,
          },
          tools: {
            information: informationTool,
          },
        },
      );

      if (process.env.KAIROS_LOG_FORCED_DEBATE === "1") {
        console.info(
          JSON.stringify(
            {
              messages: result.messages,
              toolEvents: result.toolEvents.map((event) => ({
                toolName: event.toolName,
                requestedBy: event.requestedBy,
                status: event.status,
                summary: event.summary,
                citationCount: event.citations.length,
              })),
              finalDecision: result.finalDecision,
            },
            null,
            2,
          ),
        );
      }

      expect(result.status).toBe("completed");
      expect(result.messages.some((message) => message.agentName === "bull")).toBe(
        true,
      );
      expect(result.messages.some((message) => message.agentName === "bear")).toBe(
        true,
      );
      expect(result.toolEvents.length).toBeGreaterThanOrEqual(2);
      expect(result.toolEvents.some((event) => event.requestedBy === "bull")).toBe(
        true,
      );
      expect(result.toolEvents.some((event) => event.requestedBy === "bear")).toBe(
        true,
      );
      expect(result.toolEvents.every((event) => event.status === "completed")).toBe(
        true,
      );
      expect(result.finalDecision.summary.length).toBeGreaterThan(20);
      expect(result.finalDecision.confidence).toBeGreaterThanOrEqual(0);
      expect(result.finalDecision.confidence).toBeLessThanOrEqual(1);
    },
    120_000,
  );
});
