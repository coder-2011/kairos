import { z } from "zod";

import { citationSchema } from "../debate/schema.js";

export const informationToolNameSchema = z.enum([
  "exa_search",
  "exa_research",
  "exa_contents",
  "finnhub_quote",
  "finnhub_company_news",
  "finnhub_stock_candles",
  "finnhub_aggregate_indicator",
  "finnhub_basic_financials",
  "finnhub_company_earnings",
  "finnhub_company_eps_estimates",
  "finnhub_company_peers",
  "finnhub_company_profile",
  "finnhub_earnings_calendar",
  "finnhub_filings",
  "finnhub_financials_reported",
  "finnhub_insider_transactions",
  "finnhub_news_sentiment",
  "finnhub_ownership",
  "finnhub_press_releases",
  "finnhub_recommendation_trends",
  "finnhub_social_sentiment",
  "finnhub_supply_chain_relationships",
  "finnhub_upgrade_downgrade",
  "supermemory_search",
]);

export const informationRequestSchema = z
  .object({
    query: z.string().min(1),
  })
  .strict();

export const informationPlanSchema = z
  .object({
    reasoning: z.string().min(1),
    toolCalls: z
      .array(
        z
          .object({
            toolName: informationToolNameSchema,
            input: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

export const informationToolResultSchema = z
  .object({
    toolName: informationToolNameSchema,
    input: z.string(),
    summary: z.string(),
    citations: z.array(citationSchema),
    raw: z.unknown().optional(),
  })
  .strict();

export const informationResultSchema = z
  .object({
    summary: z.string().min(1),
    citations: z.array(citationSchema),
  })
  .strict();
