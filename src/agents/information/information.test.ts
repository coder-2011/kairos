import { describe, expect, it, vi } from "vitest";

import { createGlobalToolRegistry } from "../../global/tools.js";
import {
  FINNHUB_REST_ENDPOINT_CATALOG,
  resolveKairosModelConfig,
} from "../../global/index.js";
import { buildInformationPlannerMessage } from "./prompt.js";
import { runInformationAgent } from "./agent.js";
import { informationToolNameSchema } from "./schema.js";
import {
  createInformationDebateTools,
  createInformationToolSet,
} from "./tool.js";
import type {
  InformationAgentDependencies,
  InformationPlan,
  StructuredInformationModelProvider,
} from "./types.js";

function fakeModel(outputs: unknown[]): StructuredInformationModelProvider {
  const queue = [...outputs];

  return {
    withStructuredOutput: <T>() => ({
      invoke: async (): Promise<T> => {
        const output = queue.shift();
        if (output === undefined) {
          throw new Error("No fake structured model output was queued.");
        }

        return output as T;
      },
    }),
  };
}

function fakeDeps(
  overrides: Partial<InformationAgentDependencies> = {},
): InformationAgentDependencies {
  return {
    now: () => new Date("2026-05-03T12:00:00.000Z"),
    allowDeterministicFallback: true,
    exa: {
      search: vi.fn(async () => ({
        results: [
          {
            title: "PLTR signs new government contract",
            url: "https://example.com/pltr-contract",
            author: "Example News",
            summary: "Palantir announced a new government contract.",
          },
        ],
      })),
      answer: vi.fn(async () => ({
        answer: "The most material recent PLTR catalyst is contract momentum.",
        citations: [
          {
            title: "PLTR catalyst overview",
            url: "https://example.com/pltr-catalyst",
            author: "Example Research",
          },
        ],
      })),
      contents: vi.fn(async () => ({
        results: [
          {
            title: "Source article",
            url: "https://example.com/source",
            text: "Full source text.",
          },
        ],
      })),
    },
    finnhub: {
      quote: vi.fn(async () => ({ c: 42, pc: 40, d: 2, dp: 5 })),
      companyNews: vi.fn(async () => [
        {
          datetime: 1_777_808_000,
          headline: "PLTR expands enterprise work",
          source: "Finnhub News",
          summary: "Recent company news summary.",
          url: "https://example.com/pltr-news",
        },
      ]),
      basicFinancials: vi.fn(async () => ({
        metric: {
          peNormalizedAnnual: 80,
          revenueGrowthTTMYoy: 20,
        },
      })),
    },
    supermemory: {
      search: vi.fn(async () => ({
        results: [
          {
            id: "mem_1",
            memory: "Prior Kairos note: prefer cited, non-promotional sources.",
            similarity: 0.82,
          },
        ],
      })),
    },
    ...overrides,
  };
}

describe("information agent", () => {
  it("uses the configured default model map for each agent role", () => {
    expect(resolveKairosModelConfig("heartbeat", {} as NodeJS.ProcessEnv)).toEqual({
      model: "google/gemma-4-31b-it",
      reasoning: undefined,
    });
    expect(
      resolveKairosModelConfig("informationPlanner", {} as NodeJS.ProcessEnv),
    ).toEqual({
      model: "google/gemma-4-31b-it",
      reasoning: undefined,
    });
    expect(resolveKairosModelConfig("debateBull", {} as NodeJS.ProcessEnv)).toEqual({
      model: "openai/gpt-5.5",
      reasoning: { effort: "xhigh" },
    });
    expect(resolveKairosModelConfig("debateBear", {} as NodeJS.ProcessEnv)).toEqual({
      model: "google/gemini-3.1-pro-preview",
      reasoning: { effort: "high" },
    });
    expect(resolveKairosModelConfig("debateJudge", {} as NodeJS.ProcessEnv)).toEqual({
      model: "anthropic/claude-opus-4.7",
      reasoning: { effort: "high" },
    });
    expect(resolveKairosModelConfig("debateFinal", {} as NodeJS.ProcessEnv)).toEqual({
      model: "anthropic/claude-opus-4.7",
      reasoning: { effort: "high" },
    });
  });

  it("exposes non-premium Finnhub wrapper methods by default", () => {
    const finnhub = {
      apiRequest: vi.fn(),
      quote: vi.fn(),
      companyNews: vi.fn(),
      stockCandles: vi.fn(),
      aggregateIndicator: vi.fn(),
      basicFinancials: vi.fn(),
      companyEarnings: vi.fn(),
      companyEpsEstimates: vi.fn(),
      companyPeers: vi.fn(),
      companyProfile2: vi.fn(),
      earningsCalendar: vi.fn(),
      filings: vi.fn(),
      financialsReported: vi.fn(),
      insiderTransactions: vi.fn(),
      newsSentiment: vi.fn(),
      ownership: vi.fn(),
      pressReleases: vi.fn(),
      recommendationTrends: vi.fn(),
      socialSentiment: vi.fn(),
      supplyChainRelationships: vi.fn(),
      upgradeDowngrade: vi.fn(),
    };
    const registry = createGlobalToolRegistry({ finnhub });
    const finnhubToolNames = Object.keys(registry).filter((name) =>
      name.startsWith("finnhub_"),
    );

    expect(finnhubToolNames).toHaveLength(12);
    expect(finnhubToolNames).toContain("finnhub_api_request");
    expect(finnhubToolNames).toContain("finnhub_filings");
    expect(finnhubToolNames).not.toContain("finnhub_stock_candles");
    expect(finnhubToolNames).not.toContain("finnhub_news_sentiment");
    finnhubToolNames.forEach((toolName) => {
      expect(informationToolNameSchema.safeParse(toolName).success).toBe(true);
    });
  });

  it("exposes premium Finnhub wrapper methods when premium access is enabled", () => {
    const finnhub = {
      apiRequest: vi.fn(),
      quote: vi.fn(),
      companyNews: vi.fn(),
      stockCandles: vi.fn(),
      aggregateIndicator: vi.fn(),
      basicFinancials: vi.fn(),
      companyEarnings: vi.fn(),
      companyEpsEstimates: vi.fn(),
      companyPeers: vi.fn(),
      companyProfile2: vi.fn(),
      earningsCalendar: vi.fn(),
      filings: vi.fn(),
      financialsReported: vi.fn(),
      insiderTransactions: vi.fn(),
      newsSentiment: vi.fn(),
      ownership: vi.fn(),
      pressReleases: vi.fn(),
      recommendationTrends: vi.fn(),
      socialSentiment: vi.fn(),
      supplyChainRelationships: vi.fn(),
      upgradeDowngrade: vi.fn(),
    };
    const registry = createGlobalToolRegistry({
      finnhub,
      finnhubPremiumAccess: true,
    });
    const finnhubToolNames = Object.keys(registry).filter((name) =>
      name.startsWith("finnhub_"),
    );

    expect(finnhubToolNames).toHaveLength(21);
    expect(finnhubToolNames).toContain("finnhub_stock_candles");
    expect(finnhubToolNames).toContain("finnhub_news_sentiment");
    finnhubToolNames.forEach((toolName) => {
      expect(informationToolNameSchema.safeParse(toolName).success).toBe(true);
    });
  });

  it("hides premium Finnhub catalog entries unless premium access is enabled", () => {
    const message = buildInformationPlannerMessage({
      query: "Find AAPL filings and analyst estimates.",
    });

    expect(FINNHUB_REST_ENDPOINT_CATALOG).toHaveLength(112);
    expect(message).not.toContain("/global-filings/search");
    expect(message).not.toContain("/stock/revenue-estimate");
    expect(message).not.toContain("/economic/code");
    expect(message).toContain("/stock/filings");
    expect(message).toContain("/country");
  });

  it("passes the full documented Finnhub REST catalog into the planner when premium access is enabled", () => {
    const message = buildInformationPlannerMessage(
      {
        query: "Find AAPL filings and analyst estimates.",
      },
      { finnhubPremiumAccess: true },
    );

    expect(message).toContain("/global-filings/search");
    expect(message).toContain("/stock/revenue-estimate");
    expect(message).toContain("/stock/usa-spending");
    expect(message).toContain("/economic/code");
  });

  it("blocks generic Finnhub premium REST requests unless premium access is enabled", async () => {
    const apiRequest = vi.fn(async () => ({ ok: true }));
    const registry = createGlobalToolRegistry({
      finnhub: { apiRequest },
      finnhubPremiumAccess: false,
    });

    const result = await registry.finnhub_api_request?.(
      JSON.stringify({
        method: "POST",
        path: "/global-filings/search",
        body: { query: "artificial intelligence", symbols: "AAPL" },
      }),
    );

    expect(result?.summary).toContain("premium endpoint");
    expect(result?.summary).toContain(
      "Proceed with other completed tool results",
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("plans from available providers, calls real dependency methods, and compiles cited output", async () => {
    const deps = fakeDeps();

    const result = await runInformationAgent("latest PLTR catalyst research", deps);

    expect(result.summary).toContain("exa_search");
    expect(result.summary).toContain("finnhub_quote");
    expect(result.citations.map((item) => item.url)).toContain(
      "https://example.com/pltr-news",
    );
    expect(deps.exa?.search).toHaveBeenCalledWith({
      query: "latest PLTR catalyst research",
      numResults: 5,
      category: "news",
    });
    expect(deps.finnhub?.companyNews).toHaveBeenCalledWith({
      symbol: "PLTR",
      from: "2026-04-26",
      to: "2026-05-03",
    });
  });

  it("supports model-selected tool plans and model-written synthesis", async () => {
    const plannerModel = fakeModel([
      {
        reasoning: "Read the provided source URL and search memory.",
        toolCalls: [
          {
            toolName: "exa_contents",
            input: "https://example.com/source",
          },
          {
            toolName: "supermemory_search",
            input: "PLTR source review",
          },
        ],
      } satisfies InformationPlan,
    ]);
    const synthesisModel = fakeModel([
      {
        summary: "Model synthesis: source text plus memory were gathered.",
        citations: [
          {
            title: "Source article",
            url: "https://example.com/source",
          },
        ],
      },
    ]);
    const deps = fakeDeps({
      plannerModel,
      synthesisModel,
    });

    const result = await runInformationAgent(
      "Read https://example.com/source for PLTR source review",
      deps,
    );

    expect(result.summary).toBe(
      "Model synthesis: source text plus memory were gathered.",
    );
    expect("toolResults" in result).toBe(false);
    expect(deps.exa?.contents).toHaveBeenCalledWith({
      urls: ["https://example.com/source"],
      maxCharacters: 10_000,
    });
  });

  it("applies configured information tool allowlists and max tool calls", async () => {
    const plannerModel = fakeModel([
      {
        reasoning: "Try search first, then quote.",
        toolCalls: [
          {
            toolName: "exa_search",
            input: "PLTR latest news",
          },
          {
            toolName: "finnhub_quote",
            input: "PLTR",
          },
        ],
      } satisfies InformationPlan,
    ]);
    const deps = fakeDeps({
      plannerModel,
      enabledTools: {
        exa_search: false,
      },
      maxToolCalls: 1,
    });

    const result = await runInformationAgent("PLTR latest news", deps);

    expect(result.summary).toContain("finnhub_quote");
    expect(result.summary).not.toContain("exa_search");
    expect(deps.exa?.search).not.toHaveBeenCalled();
    expect(deps.finnhub?.quote).toHaveBeenCalledWith("PLTR");
  });

  it("summarizes tool failures instead of throwing", async () => {
    const deps = fakeDeps({
      exa: {
        search: vi.fn(async () => {
          throw new Error("search unavailable");
        }),
        answer: vi.fn(async () => ({ answer: "", citations: [] })),
        contents: vi.fn(async () => ({ results: [] })),
      },
      finnhub: undefined,
      supermemory: undefined,
    });

    const result = await runInformationAgent("PLTR latest news", deps);

    expect(result.summary).toContain("Tool exa_search failed");
    expect("toolResults" in result).toBe(false);
  });

  it("exposes the information agent as debate and AI SDK tools", async () => {
    const deps = fakeDeps();
    const debateTools = createInformationDebateTools(deps);
    const aiTools = createInformationToolSet(deps);

    await expect(
      debateTools.information?.("PLTR latest catalyst", {
        debateId: "debate-1",
        requestedBy: "bull",
        startInput: {
          summary: "test",
          basicFinancials: {},
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        citations: expect.any(Array),
      }),
    );
    expect(aiTools.information).toBeDefined();
  });
});
