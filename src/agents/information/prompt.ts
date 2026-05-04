import type {
  InformationRequest,
  InformationToolName,
  InformationToolResult,
} from "./types.js";
import { finnhubEndpointCatalogForAccess } from "../../global/finnhub-catalog.js";
import { informationToolCatalogForAccess } from "./tool-catalog.js";

const BASE_AVAILABLE_TOOLS = [
  "exa_search",
  "exa_research",
  "exa_contents",
  "finnhub_api_request",
  "finnhub_quote",
  "finnhub_company_news",
  "finnhub_basic_financials",
  "finnhub_company_earnings",
  "finnhub_company_peers",
  "finnhub_company_profile",
  "finnhub_earnings_calendar",
  "finnhub_filings",
  "finnhub_financials_reported",
  "finnhub_insider_transactions",
  "finnhub_recommendation_trends",
  "supermemory_search",
] as const;

const PREMIUM_AVAILABLE_TOOLS = [
  "finnhub_stock_candles",
  "finnhub_aggregate_indicator",
  "finnhub_company_eps_estimates",
  "finnhub_news_sentiment",
  "finnhub_ownership",
  "finnhub_press_releases",
  "finnhub_social_sentiment",
  "finnhub_supply_chain_relationships",
  "finnhub_upgrade_downgrade",
] as const;

export const INFORMATION_PLANNER_SYSTEM_PROMPT = [
  "# Role",
  "You are the Kairos information agent planner.",
  "# Product Context",
  "Kairos is human-steered trading research: laws are asset-specific evidence theses, branches monitor one law, and heartbeat/debate agents ask you for cited market, source, memory, or company facts.",
  "# Task",
  "Given one plain-language query, choose the smallest useful tool set for cited market context.",
  "# Planning Rules",
  "For heartbeat/debate handoffs, verify catalyst, asset, date, and source quality before broad background.",
  "Use the injected tool catalog as the source of available tools and input formats.",
  "Pick question-specific tools; do not default to generic news, quote, or financial data.",
  "Prefer 2-4 tool calls. Do not call every tool by default.",
  "# Tool Selection",
  "Use Exa for recent sources, broad research, source contents, materiality, comparisons, or why a catalyst matters.",
  "Use Finnhub when a ticker plus market, technical, financial, analyst, earnings, filings, ownership, insider, sentiment, supply-chain, or profile data would improve the answer.",
  "Use finnhub_api_request only for documented injected Finnhub endpoints without named convenience tools.",
  "Use supermemory_search when prior Kairos memory, corrections, preferences, or false positives may matter.",
  "# Constraints",
  "Do not make buy/sell, notification, position sizing, or execution decisions.",
  "# Output",
  "Return only the structured information plan.",
].join("\n");

export const INFORMATION_SYNTHESIS_SYSTEM_PROMPT = [
  "# Role",
  "You are the Kairos information agent synthesizer.",
  "# Product Context",
  "Kairos is human-steered trading research: laws are asset-specific evidence theses, branches monitor one law, and another agent consumes your cited market, source, memory, or company facts.",
  "# Task",
  "Compile tool results into a concise, evidence-first answer for another agent.",
  "# Synthesis Rules",
  "Put decision-relevant facts first: what happened, why it may matter, timing, magnitude, and source quality.",
  "Separate confirmed facts from uncertain interpretation in plain language.",
  "If evidence is thin, stale, contradictory, promotional, or a tool failed, say that plainly.",
  "# Citations",
  "Use citations only for source URLs returned by tools.",
  "# Constraints",
  "Keep it neutral. Do not expose raw JSON, internal implementation details, buy/sell decisions, notification decisions, or certainty beyond the sources.",
  "# Output",
  "Return only summary and citations.",
].join("\n");

export function buildInformationPlannerMessage(
  request: InformationRequest,
  options: {
    finnhubPremiumAccess?: boolean;
    availableTools?: readonly InformationToolName[];
  } = {},
): string {
  const defaultTools = options.finnhubPremiumAccess
    ? [...BASE_AVAILABLE_TOOLS, ...PREMIUM_AVAILABLE_TOOLS]
    : BASE_AVAILABLE_TOOLS;

  return JSON.stringify(
    {
      query: request.query,
      availableTools: options.availableTools ?? defaultTools,
      toolCatalog: informationToolCatalogForAccess({
        finnhubPremiumAccess: options.finnhubPremiumAccess,
        availableTools: options.availableTools ?? defaultTools,
      }),
      finnhubPremiumAccess: options.finnhubPremiumAccess ?? false,
      finnhubApiRequestEndpointCatalog: finnhubEndpointCatalogForAccess({
        premiumAccess: options.finnhubPremiumAccess ?? false,
      }),
      frontendConfigurationGuidance: {
        configureInFrontend: [
          "which named tools are enabled",
          "whether Finnhub premium access is enabled",
          "max information tool calls per request",
          "branch-specific research/seeding instructions",
        ],
        doNotConfigureInFrontend: [
          "raw Finnhub endpoint parameter shapes",
          "secret API keys",
          "agent-internal retry behavior",
        ],
      },
    },
    null,
    2,
  );
}

export function buildInformationSynthesisMessage(input: {
  request: InformationRequest;
  toolResults: InformationToolResult[];
}): string {
  return JSON.stringify(
    {
      request: input.request,
      toolResults: input.toolResults.map((result) => ({
        toolName: result.toolName,
        input: result.input,
        summary: result.summary,
        citations: result.citations,
      })),
    },
    null,
    2,
  );
}
