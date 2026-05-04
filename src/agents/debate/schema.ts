import { z } from "zod";

export const citationSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().min(1),
    source: z.string().optional(),
  })
  .strict();

export const basicFinancialsSchema = z.record(z.string(), z.unknown());
export const debatePortfolioContextSchema = z.record(z.string(), z.unknown());
export const debateDecisionActionSchema = z.enum([
  "buy",
  "sell",
  "watch",
  "research",
  "no_action",
]);

export const debateDecisionSizingSchema = z
  .object({
    qty: z.number().positive().optional(),
    notional: z.number().positive().optional(),
    orderType: z.enum(["market", "limit"]).optional(),
    limitPrice: z.number().positive().optional(),
    rationale: z.string().min(1),
  })
  .strict()
  .refine((sizing) => sizing.qty !== undefined || sizing.notional !== undefined, {
    message: "Sizing requires qty or notional.",
    path: ["qty"],
  })
  .refine((sizing) => sizing.orderType !== "limit" || sizing.limitPrice !== undefined, {
    message: "Limit sizing requires limitPrice.",
    path: ["limitPrice"],
  });

export const debateStartInputSchema = z
  .object({
    summary: z.string().min(1),
    basicFinancials: basicFinancialsSchema,
    portfolioContext: debatePortfolioContextSchema.optional(),
  })
  .strict();

export const debateMessageSchema = z
  .object({
    agentName: z.enum(["judge", "bull", "bear", "tool_agent"]),
    messageType: z.enum(["argument", "plan", "tool_result", "final"]),
    argument: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const humanInterjectionSchema = z
  .object({
    timestamp: z.string(),
    summary: z.string().min(1),
  })
  .strict();

export const debateDecisionSchema = z
  .object({
    summary: z.string().min(1),
    action: debateDecisionActionSchema,
    confidence: z.number().min(0).max(1),
    sizing: debateDecisionSizingSchema.optional(),
    citations: z.array(citationSchema),
  })
  .refine((decision) => {
    if (decision.action === "buy" || decision.action === "sell") {
      return decision.sizing !== undefined;
    }
    return decision.sizing === undefined;
  }, {
    message: "Buy and sell decisions require sizing; non-trade actions must not include sizing.",
    path: ["sizing"],
  })
  .strict();

export const debateToolRequestSchema = z
  .object({
    toolName: z.enum(["exa_search", "exa_research", "information", "portfolio"]),
    input: z.string().min(1),
  })
  .strict();

export const judgePlanSchema = z
  .object({
    plan: z.string().min(1),
    nextNode: z.enum(["bull", "bear", "final"]),
  })
  .strict();

export const debateAgentOutputSchema = z
  .object({
    argument: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    toolRequest: debateToolRequestSchema.nullish(),
  })
  .strict();

export const debateToolResultSchema = z
  .object({
    summary: z.string().min(1),
    citations: z.array(citationSchema).optional(),
    outputRef: z.string().optional(),
  })
  .strict();

export const debateToolEventSchema = z
  .object({
    toolEventId: z.string(),
    debateId: z.string(),
    toolName: z.enum(["exa_search", "exa_research", "information", "portfolio"]),
    requestedBy: z.enum(["judge", "bull", "bear"]),
    input: z.string(),
    summary: z.string(),
    outputRef: z.string().optional(),
    citations: z.array(citationSchema),
    status: z.enum(["started", "completed", "failed"]),
    error: z.string().optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
  })
  .strict();

export const debateBudgetsSchema = z
  .object({
    maxTurns: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
  })
  .strict();

export const defaultDebateBudgets = {
  maxTurns: 6,
  maxToolCalls: 5,
} as const;

export type DebateStartInputFromSchema = z.infer<
  typeof debateStartInputSchema
>;
export type DebateDecisionFromSchema = z.infer<typeof debateDecisionSchema>;
