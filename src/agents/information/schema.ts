import { z } from "zod";

import { citationSchema } from "../debate/schema.js";

export const informationToolNameSchema = z.enum([
  "exa_search",
  "exa_research",
  "exa_contents",
  "finnhub_quote",
  "finnhub_company_news",
  "finnhub_basic_financials",
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
