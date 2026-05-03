import type { Citation } from "../debate/types.js";
import type { ExaApi } from "../../api/exa.js";
import type { FinnhubApi } from "../../api/finnhub.js";
import type { GlobalMemoryApi } from "../../global/memory.js";
import type { AgentObserver } from "../../global/observability.js";

export type InformationToolName =
  | "exa_search"
  | "exa_research"
  | "exa_contents"
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
  | "supermemory_search";

export type InformationRequest = {
  query: string;
};

export type InformationPlan = {
  reasoning: string;
  toolCalls: Array<{
    toolName: InformationToolName;
    input: string;
  }>;
};

export type InformationToolResult = {
  toolName: InformationToolName;
  input: string;
  summary: string;
  citations: Citation[];
  raw?: unknown;
};

export type InformationResult = {
  summary: string;
  citations: Citation[];
};

export type StructuredInformationModel<T> = {
  invoke: (input: unknown) => Promise<T>;
};

export type StructuredInformationModelProvider = {
  withStructuredOutput: <T>(schema: unknown) => StructuredInformationModel<T>;
};

export type InformationExaClient = Pick<ExaApi, "search" | "answer" | "contents">;
export type InformationFinnhubClient = Partial<
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
export type InformationSupermemoryClient = Pick<GlobalMemoryApi, "search">;

export type InformationAgentDependencies = {
  model?: StructuredInformationModelProvider;
  plannerModel?: StructuredInformationModelProvider;
  synthesisModel?: StructuredInformationModelProvider;
  exa?: InformationExaClient;
  finnhub?: InformationFinnhubClient;
  finnhubPremiumAccess?: boolean;
  memory?: InformationSupermemoryClient;
  supermemory?: InformationSupermemoryClient;
  supermemoryContainerTag?: string;
  now?: () => Date;
  observer?: AgentObserver;
  runId?: string;
};
