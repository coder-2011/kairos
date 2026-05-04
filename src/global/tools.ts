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
import { withRetry } from "./retry.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_TEXT = 2000;
const MAX_ERROR_TEXT = 600;
const MAX_NEWS_SUMMARY_LENGTH = 240;
const MAX_EXA_RESULTS = 5;
const MAX_EXA_CONTENT_CHARACTERS = 10_000;
const MAX_TOOL_LIST_ITEMS = 5;
const MAX_RAW_SNIPPET_LENGTH = 1200;
const TOOL_RETRY_ATTEMPTS = 2;
const TOOL_RETRY_DELAY_MS = 50;
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
  containerTag: z
    .string()
    .describe("Branch-scoped Supermemory profile container tag, for example branch_profile_pltr_deals."),
  query: z
    .string()
    .describe("Plain-language query describing the branch law, catalyst, or memory context to retrieve."),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional similarity threshold from 0 to 1. Leave unset unless stricter memory relevance is needed."),
});
const supermemorySearchInputSchema = z.object({
  containerTag: z
    .string()
    .describe("Branch-scoped Supermemory profile container tag, for example branch_profile_pltr_deals."),
  query: z
    .string()
    .describe("Plain-language search query for prior events, human corrections, false positives, or branch preferences."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum memories to return. Use small limits such as 3-5 for heartbeat triage."),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional similarity threshold from 0 to 1. Leave unset unless stricter duplicate checks are needed."),
});
const exaNewsSearchInputSchema = z.object({
  query: z
    .string()
    .describe("Specific current-news query for one catalyst, company, asset, or claim. Example: PLTR new government contract May 2026."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of news results to return. Use 3-5 for focused corroboration."),
});

function compactText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trimEnd()}...`
    : value;
}

function formatToolError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Tool ${toolName} failed: ${message}`;
}

function toolFailureResult(
  toolName: string,
  error: unknown,
  suggestion?: string,
): GlobalToolResult {
  const actionMessage = [
    formatToolError(toolName, error),
    suggestion ?? "Proceed with other completed tool results.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    summary: compactText(actionMessage, MAX_ERROR_TEXT),
    citations: [],
  };
}

function toolCallSafe<T extends GlobalToolResult>(
  toolName: string,
  action: () => Promise<T>,
  suggestion?: string,
  required = false,
): Promise<T> {
  return withRetry(action, {
    attempts: TOOL_RETRY_ATTEMPTS,
    delayMs: TOOL_RETRY_DELAY_MS,
  }).catch((error) => {
    if (required) {
      throw error;
    }

    return toolFailureResult(toolName, error, suggestion) as T;
  });
}

function summarizeUnknown(value: unknown, maxLength = MAX_SUMMARY_TEXT): string {
  if (typeof value === "string") {
    return compactText(value, maxLength);
  }

  const text =
    value === undefined ? "" : JSON.stringify(value, null, 2);
  return compactText(text, maxLength);
}

function summarizeListItems(items: unknown[], maxItems: number, maxItemLength: number): string[] {
  return items
    .slice(0, maxItems)
    .map((item, index) => `${index + 1}. ${summarizeUnknown(item, maxItemLength)}`);
}

function summarizeMemoryEntries(entries: unknown[], maxItems = MAX_TOOL_LIST_ITEMS): string {
  return entries
    .slice(0, maxItems)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return summarizeUnknown(item, MAX_SUMMARY_TEXT);
      }

      const record = item as Record<string, unknown>;
      const memoryText =
        typeof record.memory === "string" ? record.memory : summarizeUnknown(record, 400);
      const similarity =
        typeof record.similarity === "number"
          ? ` (similarity ${record.similarity.toFixed(2)})`
          : "";

      return `${memoryText}${similarity}`;
    })
    .join("\n");
}

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
  deepResearch?: (
    input: string,
    context?: GlobalToolContext,
  ) => Promise<GlobalToolResult>;
  exa?: Pick<ExaApi, "search" | "answer" | "deepResearch" | "contents">;
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
  requiredTools?: Partial<Record<GlobalToolName, boolean>>;
  memory?: Pick<GlobalMemoryApi, "search"> & Partial<Pick<GlobalMemoryApi, "profile">>;
  memoryContainerTag?: string;
  now?: () => Date;
};

export function createGlobalToolRegistry(
  deps: GlobalToolDependencies = {},
): GlobalToolRegistry {
  const registry: GlobalToolRegistry = {};
  const registerTool = (
    name: GlobalToolName,
    handler: GlobalToolHandler,
    suggestion?: string,
  ): void => {
    registry[name] = (input, context) =>
      toolCallSafe(
        name,
        () => handler(input, context),
        suggestion,
        deps.requiredTools?.[name] === true,
      );
  };
  const summarizeFinnhubResult = (
    label: string,
    raw: unknown,
    citations: GlobalToolCitation[] = [],
  ): GlobalToolResult => {
    const isArray = Array.isArray(raw);
    const arrayLength = isArray ? raw.length : 0;
    const compacted =
      isArray
        ? summarizeListItems(raw, MAX_TOOL_LIST_ITEMS, MAX_RAW_SNIPPET_LENGTH).join(
            "\n",
          )
        : summarizeUnknown(raw);
    const truncated = compactText(compacted, MAX_SUMMARY_TEXT);
    const note = isArray && arrayLength > MAX_TOOL_LIST_ITEMS
      ? ` Showing ${Math.min(arrayLength, MAX_TOOL_LIST_ITEMS)} of ${arrayLength} items.`
      : "";

    return {
      summary: `${label}: ${truncated}${note}`,
      citations,
      raw,
    };
  };
  const summarizeCompanyNews = (ticker: string, news: unknown[]): GlobalToolResult => {
    const topNews = news.slice(0, MAX_TOOL_LIST_ITEMS);
    return {
      summary:
        topNews
          .map((item) => {
            if (!item || typeof item !== "object") {
              return summarizeUnknown(item);
            }

            const record = item as Record<string, unknown>;
            return [
              record.headline ?? "Untitled",
              record.source,
              compactText(
                typeof record.summary === "string"
                  ? record.summary
                  : summarizeUnknown(record.summary),
                MAX_NEWS_SUMMARY_LENGTH,
              ),
              record.url,
            ]
              .filter(Boolean)
              .join(" - ");
          })
          .join("\n"),
      citations: topNews
        .filter((item) => {
          const record = item as Record<string, unknown>;
          return item && typeof item === "object" && typeof record.url === "string";
        })
        .map((item) => {
          const record = item as Record<string, unknown>;
          return {
            title:
              typeof record.headline === "string" ? record.headline : undefined,
            url: record.url as string,
            source: typeof record.source === "string" ? record.source : undefined,
          };
        }),
      raw: topNews,
    };
  };

  if (deps.exa) {
    const runExaSearch = async (input: string): Promise<GlobalToolResult> => {
      const response = await deps.exa?.search({
        query: input,
        numResults: MAX_EXA_RESULTS,
        category: "news",
      });
      return summarizeExaResults(response);
    };
    registerTool(
      "exa_search",
      runExaSearch,
      "If search is unavailable, continue with seeded context and other tool results.",
    );
    registerTool(
      "exa_news_search",
      runExaSearch,
      "If search is unavailable, continue with seeded context and other tool results.",
    );
    registerTool(
      "exa_research",
      async (input, _context) => {
        if (deps.deepResearch) {
          return deps.deepResearch(input, _context);
        }

        const response = deps.exa?.deepResearch
          ? await deps.exa.deepResearch({
            query: input,
            numResults: MAX_EXA_RESULTS,
            contents: {
              highlights: {
                query: "source-backed material claims, numbers, dates, and guidance",
              },
              text: {
                maxCharacters: 10_000,
              },
            },
          })
          : deps.exa?.search
            ? await deps.exa.search({
              query: input,
              type: "deep",
              numResults: MAX_EXA_RESULTS,
              outputSchema: {
                type: "text",
                description: "concise source-backed synthesis",
              },
              contents: {
                highlights: {
                  query: "source-backed material claims, numbers, dates, and guidance",
                },
                text: {
                  maxCharacters: 10_000,
                },
              },
            })
            : undefined;
        if (!response) {
          return toolFailureResult("exa_research", new Error("Exa client is not configured."), "Enable EXA tool access in environment.");
        }
        const summaryFromOutput =
          typeof response?.output?.content === "string"
            ? response.output.content
            : response?.output?.content
              ? JSON.stringify(response.output.content)
              : response?.results
                  .map((item) =>
                    compactText(
                      item.summary ??
                        item.highlights?.join(" ") ??
                        "",
                      500,
                    ),
                  )
                  .join("\n");
        const resultCitations =
          response?.results
            ?.filter((item) => item.url)
            .map((item) => ({
              title: item.title,
              url: item.url,
              source: item.author,
            })) ?? [];
        const groundingCitations =
          response?.output?.grounding
            ?.flatMap((entry) => entry.citations ?? [])
            .filter((citation) => citation.url !== undefined)
            .map((citation) => ({
              title: citation.title,
              url: citation.url,
            })) ?? [];
        const citationsByUrl = new Map<string, GlobalToolCitation>();
        for (const citation of [...resultCitations, ...groundingCitations]) {
          citationsByUrl.set(citation.url, citation);
        }
        return {
          summary: compactText(
            summaryFromOutput && summaryFromOutput.length > 0
              ? summaryFromOutput
              : "No deep research output text returned.",
            MAX_SUMMARY_TEXT,
          ),
          citations: [...citationsByUrl.values()],
          raw: response,
        };
      },
      "Try another concrete query or continue with existing evidence.",
    );
    registerTool(
      "exa_contents",
      async (input) => {
        const urls = extractUrls(input);
        const response = await deps.exa?.contents({
          urls: urls.length > 0 ? urls : [input],
          maxCharacters: MAX_EXA_CONTENT_CHARACTERS,
        });
        const results = response?.results?.slice(0, MAX_EXA_RESULTS) ?? [];
        return {
          summary: results
            .map((item) =>
              [
                item.title ?? item.url,
                compactText(item.summary ?? item.text ?? "", MAX_RAW_SNIPPET_LENGTH),
              ]
                .filter(Boolean)
                .join(" - "),
            )
            .join("\n\n"),
          citations: results
            .filter((item) => item.url)
            .map((item) => ({
              title: item.title,
              url: item.url,
              source: item.author,
            })),
          raw: response,
        };
      },
      "Proceed with source summaries from the best available tool result.",
    );
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
    const apiRequest = deps.finnhub.apiRequest;
    if (apiRequest) {
      registerTool(
        "finnhub_api_request",
        async (input) => {
          const request = parseFinnhubApiRequest(input);
          if (!premiumAccess && isFinnhubPremiumPath(request.path)) {
            throw new Error(
              `Finnhub premium endpoint ${request.path} requested while FINNHUB_PREMIUM_ACCESS is disabled.`,
            );
          }
          const result = await apiRequest(request);
          return summarizeFinnhubResult(
            `Finnhub API request ${request.path}`,
            result,
            extractFinnhubUrlCitations(result),
          );
        },
        "Premium endpoint calls are blocked. If important, retry with an available non-premium endpoint or continue without this tool.",
      );
    }

    const quote = deps.finnhub.quote;
    if (quote) {
      registerTool(
        "finnhub_quote",
        async (input) => {
          const ticker = tickerInput(input);
          const rawQuote = await quote(ticker);
          const record =
            rawQuote && typeof rawQuote === "object" && !Array.isArray(rawQuote)
              ? (rawQuote as Record<string, unknown>)
              : {};
          const summary =
            `Finnhub quote for ${ticker}: ` +
            `c=${record.c ?? "n/a"}, dp=${record.dp ?? "n/a"}, d=${record.d ?? "n/a"}, ` +
            `h=${record.h ?? "n/a"}, l=${record.l ?? "n/a"}, o=${record.o ?? "n/a"}`;

          return {
            summary,
            citations: [],
            raw: rawQuote,
          };
        },
        "If quote is unavailable, continue with alternative market/context tools.",
      );
    }
    const companyNews = deps.finnhub.companyNews;
    if (companyNews) {
      registerTool(
        "finnhub_company_news",
        async (input, context) => {
        const ticker = tickerInput(input);
        const { from, to } = dateWindow(context, 7);
        const news = await companyNews({ symbol: ticker, from, to });
          if (!Array.isArray(news)) {
            return {
              summary: `No company news available for ${ticker}.`,
              citations: [],
              raw: [],
            };
          }
          return summarizeCompanyNews(ticker, news);
        },
        "Company-news data is optional; continue with other context sources if this fails.",
      );
    }
    const stockCandles = deps.finnhub.stockCandles;
    if (stockCandles && premiumAccess) {
      registerTool(
        "finnhub_stock_candles",
        async (input, context) => {
          const ticker = tickerInput(input);
          const { from, to } = unixWindow(context, 30);
          const candles = await stockCandles({
            symbol: ticker,
            resolution: "D",
            from,
            to,
          });
          return summarizeFinnhubResult(
            `Finnhub daily stock candles for ${ticker} over the last 30 days`,
            candles,
          );
        },
        "Skip this tool first if a summary can be produced from quote + news.",
      );
    }
    const aggregateIndicator = deps.finnhub.aggregateIndicator;
    if (aggregateIndicator && premiumAccess) {
      registerTool(
        "finnhub_aggregate_indicator",
        async (input) => {
          const ticker = tickerInput(input);
          const indicator = await aggregateIndicator(ticker, "D");
          return summarizeFinnhubResult(
            `Finnhub aggregate technical indicator for ${ticker}`,
            indicator,
          );
        },
        "This is technical context only; continue with price/news if missing.",
      );
    }
    const basicFinancials = deps.finnhub.basicFinancials;
    if (basicFinancials) {
      registerTool(
        "finnhub_basic_financials",
        async (input) => {
          const ticker = tickerInput(input);
          const financials = await basicFinancials(ticker);
          return summarizeFinnhubResult(
            `Finnhub basic financials for ${ticker}`,
            financials,
          );
        },
        "Continue with other tools if key metrics are unavailable.",
      );
    }
    const companyEarnings = deps.finnhub.companyEarnings;
    if (companyEarnings) {
      registerTool(
        "finnhub_company_earnings",
        async (input) => {
          const ticker = tickerInput(input);
          const earnings = await companyEarnings(ticker, 4);
          return summarizeFinnhubResult(
            `Finnhub recent company earnings for ${ticker}`,
            earnings,
          );
        },
        "If earnings data is unavailable, continue with catalyst/news context.",
      );
    }
    const companyEpsEstimates = deps.finnhub.companyEpsEstimates;
    if (companyEpsEstimates && premiumAccess) {
      registerTool(
        "finnhub_company_eps_estimates",
        async (input) => {
          const ticker = tickerInput(input);
          const estimates = await companyEpsEstimates(ticker, "quarterly");
          return summarizeFinnhubResult(
            `Finnhub quarterly EPS estimates for ${ticker}`,
            estimates,
          );
        },
        "Try broader query or continue with company earnings/basic financials.",
      );
    }
    const companyPeers = deps.finnhub.companyPeers;
    if (companyPeers) {
      registerTool(
        "finnhub_company_peers",
        async (input) => {
          const ticker = tickerInput(input);
          const peers = await companyPeers(ticker);
          return summarizeFinnhubResult(`Finnhub company peers for ${ticker}`, peers);
        },
        "If peer data is not available, use profile and recommendation data instead.",
      );
    }
    const companyProfile2 = deps.finnhub.companyProfile2;
    if (companyProfile2) {
      registerTool(
        "finnhub_company_profile",
        async (input) => {
          const ticker = tickerInput(input);
          const profile = await companyProfile2(ticker);
          return summarizeFinnhubResult(
            `Finnhub company profile for ${ticker}`,
            profile,
          );
        },
        "Profile is optional context; continue with core evidence if missing.",
      );
    }
    const earningsCalendar = deps.finnhub.earningsCalendar;
    if (earningsCalendar) {
      registerTool(
        "finnhub_earnings_calendar",
        async (input, context) => {
          const ticker = tickerInput(input);
          const { from, to } = dateWindow(context, 30);
          const calendar = await earningsCalendar({
            symbol: ticker,
            from,
            to,
          });
          return summarizeFinnhubResult(
            `Finnhub earnings calendar for ${ticker} over the next/current 30-day window`,
            calendar,
          );
        },
        "If calendar data is missing, proceed with quote/news/catalyst checks.",
      );
    }
    const filings = deps.finnhub.filings;
    if (filings) {
      registerTool(
        "finnhub_filings",
        async (input, context) => {
          const ticker = tickerInput(input);
          const { from, to } = dateWindow(context, 30);
          const rawFilings = await filings({ symbol: ticker, from, to });
          return summarizeFinnhubResult(
            `Finnhub filings for ${ticker} over the last 30 days`,
            rawFilings,
            extractFinnhubUrlCitations(rawFilings),
          );
        },
        "If filings are missing, use company news and basic financials to infer event recency.",
      );
    }
    const financialsReported = deps.finnhub.financialsReported;
    if (financialsReported) {
      registerTool(
        "finnhub_financials_reported",
        async (input) => {
          const ticker = tickerInput(input);
          const financials = await financialsReported(ticker);
          return summarizeFinnhubResult(
            `Finnhub reported financials for ${ticker}`,
            financials,
          );
        },
        "If reported financials are unavailable, continue with basic financials or press releases.",
      );
    }
    const insiderTransactions = deps.finnhub.insiderTransactions;
    if (insiderTransactions) {
      registerTool(
        "finnhub_insider_transactions",
        async (input) => {
          const ticker = tickerInput(input);
          const transactions = await insiderTransactions(ticker);
          return summarizeFinnhubResult(
            `Finnhub insider transactions for ${ticker}`,
            transactions,
          );
        },
        "If insider data is unavailable, continue with valuation and earnings context.",
      );
    }
    const newsSentiment = deps.finnhub.newsSentiment;
    if (newsSentiment && premiumAccess) {
      registerTool(
        "finnhub_news_sentiment",
        async (input) => {
          const ticker = tickerInput(input);
          const sentiment = await newsSentiment(ticker);
          return summarizeFinnhubResult(
            `Finnhub news sentiment for ${ticker}`,
            sentiment,
          );
        },
        "Proceed with raw news and Exa research if sentiment is unavailable.",
      );
    }
    const ownership = deps.finnhub.ownership;
    if (ownership && premiumAccess) {
      registerTool(
        "finnhub_ownership",
        async (input) => {
          const ticker = tickerInput(input);
          const rawOwnership = await ownership(ticker, 20);
          return summarizeFinnhubResult(
            `Finnhub ownership for ${ticker}`,
            rawOwnership,
          );
        },
        "If ownership data is blocked, continue with other market/catalyst checks.",
      );
    }
    const pressReleases = deps.finnhub.pressReleases;
    if (pressReleases && premiumAccess) {
      registerTool(
        "finnhub_press_releases",
        async (input) => {
          const ticker = tickerInput(input);
          const releases = await pressReleases(ticker);
          const rawReleases = Array.isArray(releases) ? releases : [];
          return summarizeFinnhubResult(
            `Finnhub press releases for ${ticker}`,
            rawReleases,
            extractFinnhubUrlCitations(rawReleases),
          );
        },
        "Press releases are optional; continue with companyNews and filings if missing.",
      );
    }
    const recommendationTrends = deps.finnhub.recommendationTrends;
    if (recommendationTrends) {
      registerTool(
        "finnhub_recommendation_trends",
        async (input) => {
          const ticker = tickerInput(input);
          const trends = await recommendationTrends(ticker);
          return summarizeFinnhubResult(
            `Finnhub recommendation trends for ${ticker}`,
            trends,
          );
        },
        "If trend data is unavailable, continue with existing valuation and filings context.",
      );
    }
    const socialSentiment = deps.finnhub.socialSentiment;
    if (socialSentiment && premiumAccess) {
      registerTool(
        "finnhub_social_sentiment",
        async (input) => {
          const ticker = tickerInput(input);
          const sentiment = await socialSentiment(ticker);
          return summarizeFinnhubResult(
            `Finnhub social sentiment for ${ticker}`,
            sentiment,
          );
        },
        "Social sentiment is optional; continue with headline/news context if unavailable.",
      );
    }
    const supplyChainRelationships = deps.finnhub.supplyChainRelationships;
    if (supplyChainRelationships && premiumAccess) {
      registerTool(
        "finnhub_supply_chain_relationships",
        async (input) => {
          const ticker = tickerInput(input);
          const relationships = await supplyChainRelationships(ticker);
          return summarizeFinnhubResult(
            `Finnhub supply-chain relationships for ${ticker}`,
            relationships,
          );
        },
        "If supply-chain context is unavailable, continue with profile and peer analysis.",
      );
    }
    const upgradeDowngrade = deps.finnhub.upgradeDowngrade;
    if (upgradeDowngrade && premiumAccess) {
      registerTool(
        "finnhub_upgrade_downgrade",
        async (input, context) => {
          const ticker = tickerInput(input);
          const { from, to } = dateWindow(context, 30);
          const changes = await upgradeDowngrade({
            symbol: ticker,
            from,
            to,
          });
          return summarizeFinnhubResult(
            `Finnhub analyst upgrade/downgrade changes for ${ticker} over the last 30 days`,
            changes,
          );
        },
        "If upgrade/downgrade data is unavailable, continue with recommendation and news context.",
      );
    }
  }

  const profileMemory = deps.memory?.profile;
  if (profileMemory) {
    registerTool(
      "supermemory_profile",
      async (input, context) => {
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
      },
      "Use cached profile memory as context only; continue without it if stale or unavailable.",
    );
  }

  if (deps.memory) {
    registerTool(
      "supermemory_search",
      async (input, context) => {
        const containerTag =
          context?.containerTag ??
          deps.memoryContainerTag ??
          GLOBAL_MEMORY_CONTAINER_TAG;
        const memory = await deps.memory?.search({
          q: input,
          containerTag,
          limit: MAX_TOOL_LIST_ITEMS,
          searchMode: "memories",
          rerank: true,
        });
        const results = memory?.results ?? [];
        const note = results.length > MAX_TOOL_LIST_ITEMS
          ? ` Showing ${Math.min(results.length, MAX_TOOL_LIST_ITEMS)} of ${results.length} results.`
          : "";
        return {
          summary: `${summarizeMemoryEntries(results, MAX_TOOL_LIST_ITEMS)}${note}`,
          citations: [],
          raw: memory,
        };
      },
      "Use this for duplicate suppression and historical context, then continue with fresh tool results.",
    );
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
      memory
        .profile({
        containerTag,
        q: query,
        threshold,
      })
        .then((profile) => ({
          summary: summarizeUnknown(profile),
          citations: [],
          raw: profile,
        })),
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
      memory
        .search({
        q: query,
        containerTag,
        limit,
        threshold,
        rerank: true,
        searchMode: "memories",
      })
        .then((result) => ({
          summary: summarizeMemoryEntries(result?.results ?? []),
          citations: [],
          raw: result,
        })),
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
        numResults: numResults ?? MAX_EXA_RESULTS,
        category: "news",
      }).then((response) => {
        const summarized = summarizeExaResults(response);
        return {
          summary: summarized.summary,
          citations: summarized.citations,
          raw: response,
        };
      }),
  });
}

function summarizeExaResults(response: Awaited<ReturnType<ExaApi["search"]>> | undefined) {
  const results = response?.results?.slice(0, MAX_EXA_RESULTS) ?? [];
  return {
    summary:
      results
        .map((item, index) =>
          [
            `${index + 1}. ${item.title ?? "Untitled"}`,
            item.url,
            compactText(item.summary ?? "", MAX_NEWS_SUMMARY_LENGTH),
          ]
            .filter(Boolean)
            .join(" - "),
        )
        .join("\n"),
    citations:
      results.filter((item) => item.url).map((item) => ({
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
