import { describe, expect, it, vi } from "vitest";

import { createGlobalToolRegistry } from "../../global/tools.js";
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
  it("exposes every Finnhub method currently implemented by the local API wrapper", () => {
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

    expect(finnhubToolNames).toHaveLength(21);
    finnhubToolNames.forEach((toolName) => {
      expect(informationToolNameSchema.safeParse(toolName).success).toBe(true);
    });
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
    const deps = fakeDeps({
      model: fakeModel([
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
        {
          summary: "Model synthesis: source text plus memory were gathered.",
          citations: [
            {
              title: "Source article",
              url: "https://example.com/source",
            },
          ],
        },
      ]),
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

    expect(result.summary).toContain("Tool failed");
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
