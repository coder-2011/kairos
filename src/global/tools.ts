import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ExaApi } from "../api/exa.js";
import type { FinnhubApi } from "../api/finnhub.js";
import { hasFinnhubPremiumAccess } from "./env.js";
import { isFinnhubPremiumPath } from "./finnhub-catalog.js";
import {
  GLOBAL_MEMORY_CONTAINER_TAG,
  type GlobalMemoryApi,
} from "./memory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IGNORED_TICKER_TOKENS = new Set([
  "API",
  "CEO",
  "CFO",
  "CTO",
  "SEC",
  "USA",
  "USD",
  "THE",
  "AND",
  "FOR",
]);

const supermemoryProfileInputSchema = z.object({
  containerTag: z.string(),
  query: z.string(),
  threshold: z.number().min(0).max(1).optional(),
});
const supermemorySearchInputSchema = z.object({
  containerTag: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(20).optional(),
  threshold: z.number().min(0).max(1).optional(),
});
const exaNewsSearchInputSchema = z.object({
  query: z.string(),
  numResults: z.number().int().min(1).max(10).optional(),
});

export type GlobalToolName =
  | "exa_search"
  | "exa_research"
  | "exa_contents"
  | "exa_news_search"
  | "finnhub_api_request"
  | "finnhub_quote"
  | "finnhub_company_news"
  | "finnhub_stock_candles"
  | "finnhub_aggregate_indicator"
  | "finnhub_basic_financials"
  | "finnhub_company_earnings"
  | "finnhub_company_eps_estimates"
  | "finnhub_company_peers"
  | "finnhub_company_profile"
  | "finnhub_earnings_calendar"
  | "finnhub_filings"
  | "finnhub_financials_reported"
  | "finnhub_insider_transactions"
  | "finnhub_news_sentiment"
  | "finnhub_ownership"
  | "finnhub_press_releases"
  | "finnhub_recommendation_trends"
  | "finnhub_social_sentiment"
  | "finnhub_supply_chain_relationships"
  | "finnhub_upgrade_downgrade"
  | "supermemory_profile"
  | "supermemory_search";

export type GlobalToolCitation = {
  title?: string;
  url: string;
  source?: string;
};

export type GlobalToolResult = {
  summary: string;
  citations?: GlobalToolCitation[];
  outputRef?: string;
  raw?: unknown;
};

export type GlobalToolContext = {
  containerTag?: string;
  now?: Date;
  [key: string]: unknown;
};

export type GlobalToolHandler = (
  input: string,
  context?: GlobalToolContext,
) => Promise<GlobalToolResult>;

export type GlobalToolRegistry = Partial<Record<GlobalToolName, GlobalToolHandler>>;

export type GlobalToolDependencies = {
  exa?: Pick<ExaApi, "search" | "answer" | "contents">;
  finnhub?: Partial<
    Pick<
      FinnhubApi,
      | "quote"
      | "companyNews"
      | "stockCandles"
      | "aggregateIndicator"
      | "basicFinancials"
      | "companyEarnings"
      | "companyEpsEstimates"
      | "companyPeers"
      | "companyProfile2"
      | "earningsCalendar"
      | "filings"
      | "financialsReported"
      | "insiderTransactions"
      | "newsSentiment"
      | "ownership"
      | "pressReleases"
      | "recommendationTrends"
      | "socialSentiment"
      | "supplyChainRelationships"
      | "upgradeDowngrade"
      | "apiRequest"
    >
  >;
  finnhubPremiumAccess?: boolean;
  memory?: Pick<GlobalMemoryApi, "search"> & Partial<Pick<GlobalMemoryApi, "profile">>;
  memoryContainerTag?: string;
  now?: () => Date;
};

export function createGlobalToolRegistry(
  deps: GlobalToolDependencies = {},
): GlobalToolRegistry {
  const registry: GlobalToolRegistry = {};

  if (deps.exa) {
    registry.exa_search = async (input) => {
      const response = await deps.exa?.search({
        query: input,
        numResults: 5,
        category: "news",
      });
      return summarizeExaResults(response);
    };
    registry.exa_news_search = registry.exa_search;
    registry.exa_research = async (input) => {
      const response = await deps.exa?.answer({ query: input, text: true });
      return {
        summary: response?.answer ?? "",
        citations:
          response?.citations.filter((item) => item.url).map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })) ?? [],
        raw: response,
      };
    };
    registry.exa_contents = async (input) => {
      const urls = extractUrls(input);
      const response = await deps.exa?.contents({
        urls: urls.length > 0 ? urls : [input],
        maxCharacters: 10_000,
      });
      return {
        summary:
          response?.results
            .map((item) =>
              [item.title ?? item.url, item.summary ?? item.text ?? ""]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n") ?? "",
        citations:
          response?.results.filter((item) => item.url).map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })) ?? [],
        raw: response,
      };
    };
  }

  if (deps.finnhub) {
    const premiumAccess =
      deps.finnhubPremiumAccess ?? hasFinnhubPremiumAccess();
    const tickerInput = (input: string) =>
      inferTicker(input) ?? input.trim().split(/\s+/)[0];
    const dateWindow = (
      context: GlobalToolContext | undefined,
      days: number,
    ) => {
      const now = context?.now ?? deps.now?.() ?? new Date();
      return {
        from: formatDate(new Date(now.getTime() - days * DAY_MS)),
        to: formatDate(now),
      };
    };
    const unixWindow = (
      context: GlobalToolContext | undefined,
      days: number,
    ) => {
      const now = context?.now ?? deps.now?.() ?? new Date();
      return {
        from: Math.floor((now.getTime() - days * DAY_MS) / 1000),
        to: Math.floor(now.getTime() / 1000),
      };
    };
    const finnhubResult = (
      label: string,
      raw: unknown,
      citations: GlobalToolCitation[] = [],
    ): GlobalToolResult => ({
      summary: `${label}: ${summarizeUnknown(raw)}`,
      citations,
      raw,
    });

    const apiRequest = deps.finnhub.apiRequest;
    if (apiRequest) {
      registry.finnhub_api_request = async (input) => {
        const request = parseFinnhubApiRequest(input);
        if (!premiumAccess && isFinnhubPremiumPath(request.path)) {
          throw new Error(
            `Finnhub premium endpoint ${request.path} requested while FINNHUB_PREMIUM_ACCESS is disabled.`,
          );
        }
        const result = await apiRequest(request);
        return finnhubResult(
          `Finnhub API request ${request.path}`,
          result,
          extractFinnhubUrlCitations(result),
        );
      };
    }

    const quote = deps.finnhub.quote;
    if (quote) {
      registry.finnhub_quote = async (input) => {
        const ticker = tickerInput(input);
        const rawQuote = await quote(ticker);
        return {
          summary: `Finnhub quote for ${ticker}: ${summarizeUnknown(rawQuote)}`,
          citations: [],
          raw: rawQuote,
        };
      };
    }
    const companyNews = deps.finnhub.companyNews;
    if (companyNews) {
      registry.finnhub_company_news = async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = dateWindow(context, 7);
        const news = await companyNews({ symbol: ticker, from, to });
        const topNews = news.slice(0, 5);
        return {
          summary: topNews
            .map((item) =>
              [item.headline, item.source, item.summary, item.url]
                .filter(Boolean)
                .join(" - "),
            )
            .join("\n"),
          citations: topNews
            .filter((item) => item.url)
            .map((item) => ({
              title: item.headline,
              url: item.url as string,
              source: item.source,
            })),
          raw: topNews,
        };
      };
    }
    const stockCandles = deps.finnhub.stockCandles;
    if (stockCandles && premiumAccess) {
      registry.finnhub_stock_candles = async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = unixWindow(context, 30);
        const candles = await stockCandles({
          symbol: ticker,
          resolution: "D",
          from,
          to,
        });
        return finnhubResult(
          `Finnhub daily stock candles for ${ticker} over the last 30 days`,
          candles,
        );
      };
    }
    const aggregateIndicator = deps.finnhub.aggregateIndicator;
    if (aggregateIndicator && premiumAccess) {
      registry.finnhub_aggregate_indicator = async (input) => {
        const ticker = tickerInput(input);
        const indicator = await aggregateIndicator(ticker, "D");
        return finnhubResult(
          `Finnhub aggregate technical indicator for ${ticker}`,
          indicator,
        );
      };
    }
    const basicFinancials = deps.finnhub.basicFinancials;
    if (basicFinancials) {
      registry.finnhub_basic_financials = async (input) => {
        const ticker = tickerInput(input);
        const financials = await basicFinancials(ticker);
        return {
          summary: `Finnhub basic financials for ${ticker}: ${summarizeUnknown(financials)}`,
          citations: [],
          raw: financials,
        };
      };
    }
    const companyEarnings = deps.finnhub.companyEarnings;
    if (companyEarnings) {
      registry.finnhub_company_earnings = async (input) => {
        const ticker = tickerInput(input);
        const earnings = await companyEarnings(ticker, 4);
        return finnhubResult(`Finnhub recent company earnings for ${ticker}`, earnings);
      };
    }
    const companyEpsEstimates = deps.finnhub.companyEpsEstimates;
    if (companyEpsEstimates && premiumAccess) {
      registry.finnhub_company_eps_estimates = async (input) => {
        const ticker = tickerInput(input);
        const estimates = await companyEpsEstimates(ticker, "quarterly");
        return finnhubResult(
          `Finnhub quarterly EPS estimates for ${ticker}`,
          estimates,
        );
      };
    }
    const companyPeers = deps.finnhub.companyPeers;
    if (companyPeers) {
      registry.finnhub_company_peers = async (input) => {
        const ticker = tickerInput(input);
        const peers = await companyPeers(ticker);
        return finnhubResult(`Finnhub company peers for ${ticker}`, peers);
      };
    }
    const companyProfile2 = deps.finnhub.companyProfile2;
    if (companyProfile2) {
      registry.finnhub_company_profile = async (input) => {
        const ticker = tickerInput(input);
        const profile = await companyProfile2(ticker);
        return finnhubResult(`Finnhub company profile for ${ticker}`, profile);
      };
    }
    const earningsCalendar = deps.finnhub.earningsCalendar;
    if (earningsCalendar) {
      registry.finnhub_earnings_calendar = async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = dateWindow(context, 30);
        const calendar = await earningsCalendar({
          symbol: ticker,
          from,
          to,
        });
        return finnhubResult(
          `Finnhub earnings calendar for ${ticker} over the next/current 30-day window`,
          calendar,
        );
      };
    }
    const filings = deps.finnhub.filings;
    if (filings) {
      registry.finnhub_filings = async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = dateWindow(context, 30);
        const rawFilings = await filings({ symbol: ticker, from, to });
        return finnhubResult(
          `Finnhub filings for ${ticker} over the last 30 days`,
          rawFilings,
        );
      };
    }
    const financialsReported = deps.finnhub.financialsReported;
    if (financialsReported) {
      registry.finnhub_financials_reported = async (input) => {
        const ticker = tickerInput(input);
        const financials = await financialsReported(ticker);
        return finnhubResult(
          `Finnhub reported financials for ${ticker}`,
          financials,
        );
      };
    }
    const insiderTransactions = deps.finnhub.insiderTransactions;
    if (insiderTransactions) {
      registry.finnhub_insider_transactions = async (input) => {
        const ticker = tickerInput(input);
        const transactions = await insiderTransactions(ticker);
        return finnhubResult(
          `Finnhub insider transactions for ${ticker}`,
          transactions,
        );
      };
    }
    const newsSentiment = deps.finnhub.newsSentiment;
    if (newsSentiment && premiumAccess) {
      registry.finnhub_news_sentiment = async (input) => {
        const ticker = tickerInput(input);
        const sentiment = await newsSentiment(ticker);
        return finnhubResult(`Finnhub news sentiment for ${ticker}`, sentiment);
      };
    }
    const ownership = deps.finnhub.ownership;
    if (ownership && premiumAccess) {
      registry.finnhub_ownership = async (input) => {
        const ticker = tickerInput(input);
        const rawOwnership = await ownership(ticker, 20);
        return finnhubResult(`Finnhub ownership for ${ticker}`, rawOwnership);
      };
    }
    const pressReleases = deps.finnhub.pressReleases;
    if (pressReleases && premiumAccess) {
      registry.finnhub_press_releases = async (input) => {
        const ticker = tickerInput(input);
        const releases = await pressReleases(ticker);
        const rawReleases = Array.isArray(releases) ? releases.slice(0, 5) : releases;
        return finnhubResult(
          `Finnhub press releases for ${ticker}`,
          rawReleases,
          extractFinnhubUrlCitations(rawReleases),
        );
      };
    }
    const recommendationTrends = deps.finnhub.recommendationTrends;
    if (recommendationTrends) {
      registry.finnhub_recommendation_trends = async (input) => {
        const ticker = tickerInput(input);
        const trends = await recommendationTrends(ticker);
        return finnhubResult(
          `Finnhub recommendation trends for ${ticker}`,
          trends,
        );
      };
    }
    const socialSentiment = deps.finnhub.socialSentiment;
    if (socialSentiment && premiumAccess) {
      registry.finnhub_social_sentiment = async (input) => {
        const ticker = tickerInput(input);
        const sentiment = await socialSentiment(ticker);
        return finnhubResult(`Finnhub social sentiment for ${ticker}`, sentiment);
      };
    }
    const supplyChainRelationships = deps.finnhub.supplyChainRelationships;
    if (supplyChainRelationships && premiumAccess) {
      registry.finnhub_supply_chain_relationships = async (input) => {
        const ticker = tickerInput(input);
        const relationships = await supplyChainRelationships(ticker);
        return finnhubResult(
          `Finnhub supply-chain relationships for ${ticker}`,
          relationships,
        );
      };
    }
    const upgradeDowngrade = deps.finnhub.upgradeDowngrade;
    if (upgradeDowngrade && premiumAccess) {
      registry.finnhub_upgrade_downgrade = async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = dateWindow(context, 30);
        const changes = await upgradeDowngrade({
          symbol: ticker,
          from,
          to,
        });
        return finnhubResult(
          `Finnhub analyst upgrade/downgrade changes for ${ticker} over the last 30 days`,
          changes,
        );
      };
    }
  }

  const profileMemory = deps.memory?.profile;
  if (profileMemory) {
    registry.supermemory_profile = async (input, context) => {
      const containerTag =
        context?.containerTag ??
        deps.memoryContainerTag ??
        GLOBAL_MEMORY_CONTAINER_TAG;
      const profile = await profileMemory({
        containerTag,
        q: input,
      });
      return {
        summary: summarizeUnknown(profile),
        citations: [],
        raw: profile,
      };
    };
  }

  if (deps.memory) {
    registry.supermemory_search = async (input, context) => {
      const containerTag =
        context?.containerTag ??
        deps.memoryContainerTag ??
        GLOBAL_MEMORY_CONTAINER_TAG;
      const memory = await deps.memory?.search({
        q: input,
        containerTag,
        limit: 5,
        searchMode: "memories",
        rerank: true,
      });
      return {
        summary:
          memory?.results
            .map((item) => `${item.memory} (similarity ${item.similarity})`)
            .join("\n") ?? "",
        citations: [],
        raw: memory,
      };
    };
  }

  return registry;
}

export async function executeGlobalTool(input: {
  registry: GlobalToolRegistry;
  toolName: GlobalToolName;
  toolInput: string;
  context?: GlobalToolContext;
}): Promise<GlobalToolResult> {
  const handler = input.registry[input.toolName];
  if (!handler) {
    throw new Error(`No implementation registered for tool ${input.toolName}.`);
  }

  return handler(input.toolInput, input.context);
}

export function createHeartbeatTools(input: {
  memory?: Pick<GlobalMemoryApi, "profile" | "search">;
  supermemory?: Pick<GlobalMemoryApi, "profile" | "search">;
  exa?: Pick<ExaApi, "search">;
}): ToolSet {
  const memory = input.memory ?? input.supermemory;
  const tools: ToolSet = {};

  if (memory) {
    tools.supermemory_profile = createSupermemoryProfileTool(memory);
    tools.supermemory_search = createSupermemorySearchTool(memory);
  }

  if (input.exa) {
    tools.exa_news_search = createExaSearchTool(input.exa);
  }

  return tools;
}

export function createSupermemoryProfileTool(
  memory: Pick<GlobalMemoryApi, "profile">,
) {
  return tool({
    description:
      "Fetch branch-scoped Supermemory profile context. Use when you need stable or recent memory about the branch, prior human corrections, recurring false positives, or durable preferences. Do not use for fresh market/news source discovery.",
    inputSchema: supermemoryProfileInputSchema,
    execute: ({
      containerTag,
      query,
      threshold,
    }: z.infer<typeof supermemoryProfileInputSchema>) =>
      memory.profile({
        containerTag,
        q: query,
        threshold,
      }),
  });
}

export function createSupermemorySearchTool(
  memory: Pick<GlobalMemoryApi, "search">,
) {
  return tool({
    description:
      "Search branch-scoped Supermemory memories for prior related events, prior decisions, human corrections, and false positives. Use to decide whether current evidence is new or a duplicate. Do not use as a substitute for fresh news/source checks.",
    inputSchema: supermemorySearchInputSchema,
    execute: ({
      containerTag,
      query,
      limit,
      threshold,
    }: z.infer<typeof supermemorySearchInputSchema>) =>
      memory.search({
        q: query,
        containerTag,
        limit,
        threshold,
        rerank: true,
        searchMode: "memories",
      }),
  });
}

export function createExaSearchTool(exa: Pick<ExaApi, "search">) {
  return tool({
    description:
      "Search recent web/news coverage when the seeded headlines are insufficient or need source verification. Use for current external corroboration of a specific catalyst, event, or claim. Do not use for broad deep research; escalate instead.",
    inputSchema: exaNewsSearchInputSchema,
    execute: ({ query, numResults }: z.infer<typeof exaNewsSearchInputSchema>) =>
      exa.search({
        query,
        numResults,
        category: "news",
      }),
  });
}

function summarizeExaResults(response: Awaited<ReturnType<ExaApi["search"]>> | undefined) {
  return {
    summary:
      response?.results
        .map((item, index) =>
          [
            `${index + 1}. ${item.title ?? "Untitled"}`,
            item.url,
            item.summary,
          ]
            .filter(Boolean)
            .join(" - "),
        )
        .join("\n") ?? "",
    citations:
      response?.results.filter((item) => item.url).map((item) => ({
        title: item.title,
        url: item.url,
        source: item.author,
      })) ?? [],
    raw: response,
  };
}

function formatDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function inferTicker(query: string): string | undefined {
  const match = query.match(/(?:^|[^A-Za-z])\$?([A-Z]{1,5})(?=[^A-Za-z]|$)/);
  const ticker = match?.[1];
  return ticker && !IGNORED_TICKER_TOKENS.has(ticker) ? ticker : undefined;
}

function summarizeUnknown(value: unknown, maxLength = 3000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractUrls(input: string): string[] {
  return Array.from(input.matchAll(/https?:\/\/[^\s),]+/g)).map((match) =>
    match[0],
  );
}

function parseFinnhubApiRequest(input: string): {
  method?: "GET" | "POST";
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(
      'finnhub_api_request input must be JSON like {"path":"/stock/profile2","params":{"symbol":"AAPL"}}.',
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("finnhub_api_request input must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new Error("finnhub_api_request requires a non-empty path string.");
  }

  const params: Record<string, string | number | boolean | undefined> = {};
  if (record.params !== undefined) {
    if (!record.params || typeof record.params !== "object") {
      throw new Error("finnhub_api_request params must be an object when provided.");
    }

    Object.entries(record.params as Record<string, unknown>).forEach(
      ([key, value]) => {
        if (
          value === undefined ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          params[key] = value;
        }
      },
    );
  }

  const method = record.method === undefined ? "GET" : record.method;
  if (method !== "GET" && method !== "POST") {
    throw new Error('finnhub_api_request method must be "GET" or "POST".');
  }

  return {
    method,
    path: record.path,
    params,
    body: record.body,
  };
}

function extractFinnhubUrlCitations(value: unknown): GlobalToolCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const citations: GlobalToolCitation[] = [];

  value.forEach((item) => {
      if (!item || typeof item !== "object" || !("url" in item)) {
      return;
      }

      const record = item as Record<string, unknown>;
    if (typeof record.url !== "string" || record.url.length === 0) {
      return;
    }

    citations.push({
      title: typeof record.headline === "string" ? record.headline : undefined,
      url: record.url,
      source: typeof record.source === "string" ? record.source : undefined,
    });
  });

  return citations;
}
