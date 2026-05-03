import type { InformationToolName } from "./types.js";

export type InformationToolAccess = "free" | "premium" | "mixed";

export type InformationToolMetadata = {
  name: InformationToolName;
  provider: "exa" | "finnhub" | "supermemory";
  access: InformationToolAccess;
  purpose: string;
  input: string;
  configuration: string;
};

export const INFORMATION_TOOL_CATALOG: readonly InformationToolMetadata[] = [
  {
    name: "exa_search",
    provider: "exa",
    access: "free",
    purpose: "Find recent web or news sources for a specific market claim, catalyst, company, or ticker.",
    input: "Plain-language search query.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "exa_research",
    provider: "exa",
    access: "free",
    purpose: "Answer broader research questions that need synthesis across sources.",
    input: "Plain-language research question.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "exa_contents",
    provider: "exa",
    access: "free",
    purpose: "Read full text or detailed content from specific URLs found by search or supplied in the query.",
    input: "One URL or text containing URLs.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_api_request",
    provider: "finnhub",
    access: "mixed",
    purpose: "Call documented Finnhub REST endpoints that do not have a named convenience tool.",
    input: "JSON with method, endpoint path, and optional params/body. Use only endpoints from finnhubApiRequestEndpointCatalog.",
    configuration:
      "Frontend can enable/disable this escape-hatch tool and configure whether premium Finnhub endpoints are available.",
  },
  {
    name: "finnhub_quote",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch current quote, price change, and percent move for a ticker.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_company_news",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch recent company news for a ticker over the configured recent window.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_stock_candles",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch recent OHLCV candle data for price trend and technical context.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_aggregate_indicator",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch aggregate technical indicator signals for a ticker.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_basic_financials",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch core company metrics such as valuation, profitability, margins, and growth.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_company_earnings",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch recent reported earnings and surprises for a ticker.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_company_eps_estimates",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch analyst EPS estimates for earnings expectation context.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_company_peers",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch peer companies for sector, competitor, and relative-move checks.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_company_profile",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch company identity, industry, exchange, and profile metadata.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_earnings_calendar",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch earnings calendar timing for catalyst-window awareness.",
    input: "Ticker symbol or calendar query.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_filings",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch recent SEC filings for a ticker.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_financials_reported",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch reported financial statements in as-reported form.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_insider_transactions",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch recent insider transaction records for a ticker.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_news_sentiment",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch Finnhub's news sentiment signals for a ticker.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_ownership",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch institutional ownership data for a ticker.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_press_releases",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch company press releases for official source checks.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_recommendation_trends",
    provider: "finnhub",
    access: "free",
    purpose: "Fetch analyst recommendation trend history for a ticker.",
    input: "Ticker symbol.",
    configuration: "Frontend can enable/disable this named tool.",
  },
  {
    name: "finnhub_social_sentiment",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch social sentiment metrics for retail/social attention checks.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_supply_chain_relationships",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch supplier/customer relationship data for supply-chain exposure analysis.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "finnhub_upgrade_downgrade",
    provider: "finnhub",
    access: "premium",
    purpose: "Fetch recent analyst upgrades and downgrades.",
    input: "Ticker symbol.",
    configuration: "Available only when Finnhub premium access is enabled.",
  },
  {
    name: "supermemory_search",
    provider: "supermemory",
    access: "free",
    purpose: "Search Kairos memory for prior decisions, human corrections, preferences, and false-positive history.",
    input: "Plain-language memory query.",
    configuration: "Frontend can enable/disable this named tool.",
  },
] as const;

export function informationToolCatalogForAccess(input: {
  finnhubPremiumAccess?: boolean;
  availableTools?: readonly InformationToolName[];
} = {}): InformationToolMetadata[] {
  const available = new Set(input.availableTools);

  return INFORMATION_TOOL_CATALOG.filter((tool) => {
    if (available.size > 0 && !available.has(tool.name)) {
      return false;
    }

    return input.finnhubPremiumAccess || tool.access !== "premium";
  });
}
