import { describe, expect, it } from "vitest";

import { ExaApi } from "../../api/exa.js";
import { FinnhubApi } from "../../api/finnhub.js";
import { createOpenRouterChatModelForRole } from "../../api/index.js";
import { SupermemoryApi } from "../../api/supermemory.js";
import { createInformationDebateTool } from "../information/tool.js";
import { runDebateAgent } from "./agent.js";
import type {
  DebateAgentOutput,
  DebateDecision,
  DebateTool,
  JudgePlan,
  StructuredDebateModelProvider,
} from "./types.js";

const liveTestsEnabled =
  process.env.KAIROS_LIVE_TESTS === "1" && Boolean(process.env.EXA_API_KEY);
const fullLiveTestsEnabled =
  liveTestsEnabled &&
  Boolean(process.env.OPENROUTER_API_KEY) &&
  Boolean(process.env.FINNHUB_API_KEY) &&
  Boolean(process.env.SUPERMEMORY_API_KEY);

const liveIt = liveTestsEnabled ? it : it.skip;
const fullLiveIt = fullLiveTestsEnabled ? it : it.skip;

function fakeStructuredModel<T>(output: T) {
  return {
    withStructuredOutput: <U>() => ({
      invoke: async (): Promise<U> => output as unknown as U,
    }),
  };
}

function liveModel(
  role: Parameters<typeof createOpenRouterChatModelForRole>[0],
): StructuredDebateModelProvider {
  return createOpenRouterChatModelForRole(role, {
    temperature: 0,
  }) as StructuredDebateModelProvider;
}

function formatSearchResults(
  results: Awaited<ReturnType<ExaApi["search"]>>["results"],
): string {
  return results
    .map((item, index) =>
      [
        `${index + 1}. ${item.title ?? "Untitled"}`,
        item.url,
        item.summary,
      ]
        .filter(Boolean)
        .join(" - "),
    )
    .join("\n");
}

describe("debate live integrations", () => {
  liveIt(
    "runs the debate harness with a real Exa search tool",
    async () => {
      const exa = new ExaApi();

      const result = await runDebateAgent(
        {
          debateId: `live-exa-${Date.now()}`,
          startInput: {
            summary:
              "A smaller Kairos model wants to debate whether recent Palantir news contains an actionable catalyst.",
            basicFinancials: {
              ticker: "PLTR",
            },
          },
          budgets: {
            maxTurns: 1,
            maxToolCalls: 1,
          },
        },
        {
          models: {
            judge: fakeStructuredModel<JudgePlan>({
              plan: "Let the bull case run one live Exa search, then synthesize.",
              nextNode: "bull",
            }),
            bull: fakeStructuredModel<DebateAgentOutput>({
              argument:
                "Bull case needs current source discovery before deciding whether this is actionable.",
              confidence: 0.5,
              toolRequest: {
                toolName: "exa_search",
                input: "latest Palantir company news catalyst contract earnings",
              },
            }),
            final: fakeStructuredModel<DebateDecision>({
              summary:
                "Live Exa search completed; this test validates debate-to-tool wiring, not investment quality.",
              confidence: 0.5,
              citations: [],
            }),
          },
          tools: {
            exa_search: async (input) => {
              const response = await exa.search({
                query: input,
                numResults: 3,
                category: "news",
              });
              const results = response.results.slice(0, 3);

              return {
                summary: results
                  .map((item) => `${item.title ?? "Untitled"}: ${item.url}`)
                  .join("\n"),
                citations: results.map((item) => ({
                  title: item.title,
                  url: item.url,
                  source: item.author,
                })),
              };
            },
          },
        },
      );

      expect(result.status).toBe("completed");
      expect(result.toolEvents).toHaveLength(1);
      expect(result.toolEvents[0]).toMatchObject({
        toolName: "exa_search",
        requestedBy: "bull",
        status: "completed",
      });
      expect(result.toolEvents[0]?.citations.length).toBeGreaterThan(0);
    },
    30_000,
  );

  fullLiveIt(
    "runs a full live debate with OpenRouter models and live tools",
    async () => {
      const exa = new ExaApi();
      const finnhub = new FinnhubApi();
      const supermemory = new SupermemoryApi();
      const judgeModel = liveModel("debateJudge");
      const bullModel = liveModel("debateBull");
      const bearModel = liveModel("debateBear");
      const finalModel = liveModel("debateFinal");
      const informationPlannerModel = createOpenRouterChatModelForRole(
        "informationPlanner",
        { temperature: 0 },
      ) as StructuredDebateModelProvider;
      const informationSynthesisModel = createOpenRouterChatModelForRole(
        "informationSynthesis",
        { temperature: 0 },
      ) as StructuredDebateModelProvider;

      const exaSearchTool: DebateTool = async (input) => {
        const response = await exa.search({
          query: input,
          numResults: 5,
          category: "news",
        });

        return {
          summary: formatSearchResults(response.results),
          citations: response.results.map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })),
        };
      };

      const exaResearchTool: DebateTool = async (input) => {
        const response = await exa.answer({
          query: input,
          text: true,
        });

        return {
          summary: response.answer,
          citations: response.citations.map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })),
        };
      };

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
          debateId: `full-live-${Date.now()}`,
          startInput: {
            summary: [
              "Live end-to-end integration test for Kairos multi-agent debate.",
              "Topic: determine whether recent Palantir (PLTR) news suggests an actionable catalyst.",
              "Use live tools when useful. Bull should investigate the positive/actionable case.",
              "Bear should investigate risks, whether the event is already priced in, or whether evidence is weak.",
              "The judge should let both sides speak before final synthesis.",
            ].join(" "),
            basicFinancials: {
              ticker: "PLTR",
              note: "Live test seeds minimal financial context; tools may fetch more.",
            },
          },
          humanInterjections: [
            {
              timestamp: new Date().toISOString(),
              summary:
                "Human context for live test: be skeptical of promotional headlines and prefer cited sources.",
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
            exa_search: exaSearchTool,
            exa_research: exaResearchTool,
            information: informationTool,
          },
        },
      );

      expect(result.status).toBe("completed");
      expect(result.messages.some((message) => message.agentName === "bull")).toBe(
        true,
      );
      expect(result.messages.some((message) => message.agentName === "bear")).toBe(
        true,
      );
      expect(result.toolEvents.length).toBeGreaterThan(0);
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
