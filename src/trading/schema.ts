import { randomUUID } from "node:crypto";

import { z } from "zod";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const confidenceSchema = z.number().min(0).max(1);
const moneySchema = z.number().finite().nonnegative();

export const tradingModeSchema = z.enum(["disabled", "paper"]);
export const tradingOrderTypeSchema = z.enum(["market", "limit", "bracket"]);

export const kairosTradingConfigSchema = z
  .object({
    mode: tradingModeSchema.default("disabled"),
    paperAutoBuyEnabled: z.boolean().default(false),
    notifyOnBuySignal: z.boolean().default(true),
    maxNotionalPerOrder: moneySchema.default(500),
    maxOpenPositionNotionalPerSymbol: moneySchema.default(1500),
    allowedOrderType: tradingOrderTypeSchema.default("market"),
    allowQueuedOrdersWhenMarketClosed: z.boolean().default(false),
  })
  .strict();

export const tradeIntentStatusSchema = z.enum([
  "draft",
  "message_only",
  "pending_preflight",
  "submitted",
  "rejected",
  "failed",
]);

export const tradeIntentActionSchema = z.enum([
  "record_only",
  "message_human",
  "paper_trade_intent",
  "paper_order_submit",
]);

export const tradeSideSchema = z.enum(["buy", "sell"]);
export const tradeModeSchema = z.enum(["paper"]);

export const tradeIntentSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    branchId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    lawId: z.string().min(1).optional(),
    symbol: z.string().min(1),
    side: tradeSideSchema,
    mode: tradeModeSchema,
    status: tradeIntentStatusSchema,
    action: tradeIntentActionSchema,
    confidence: confidenceSchema,
    notifyThreshold: confidenceSchema,
    paperTradeThreshold: confidenceSchema,
    summary: z.string().min(1),
    rationale: z.string().optional(),
    citations: z.array(z.record(z.string(), z.unknown())).default([]),
    notional: moneySchema,
    orderType: tradingOrderTypeSchema,
    autoBuyEnabled: z.boolean(),
    requiredApproval: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createTradeIntentInputSchema = tradeIntentSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    id: z.string().min(1).optional(),
    createdAt: isoTimestampSchema.optional(),
    updatedAt: isoTimestampSchema.optional(),
  });

export const updateTradeIntentInputSchema = tradeIntentSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export const kairosMessageSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    branchId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    tradeIntentId: z.string().min(1).optional(),
    level: z.enum(["info", "warning", "action"]),
    title: z.string().min(1),
    body: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createKairosMessageInputSchema = kairosMessageSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    id: z.string().min(1).optional(),
    createdAt: isoTimestampSchema.optional(),
  });

export const brokerOrderStatusSchema = z.enum([
  "draft",
  "submitted",
  "accepted",
  "filled",
  "partially_filled",
  "canceled",
  "rejected",
  "failed",
]);

export const brokerOrderRecordSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    tradeIntentId: z.string().min(1),
    branchId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    provider: z.literal("alpaca"),
    mode: tradeModeSchema,
    status: brokerOrderStatusSchema,
    symbol: z.string().min(1),
    side: tradeSideSchema,
    notional: moneySchema.optional(),
    qty: z.string().optional(),
    type: tradingOrderTypeSchema,
    timeInForce: z.string().min(1),
    clientOrderId: z.string().min(1),
    providerOrderId: z.string().min(1).optional(),
    submittedAt: isoTimestampSchema.optional(),
    filledAt: isoTimestampSchema.optional(),
    filledQty: z.string().optional(),
    filledAvgPrice: z.string().optional(),
    request: z.record(z.string(), z.unknown()),
    response: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  })
  .strict();

export const createBrokerOrderInputSchema = brokerOrderRecordSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    id: z.string().min(1).optional(),
    createdAt: isoTimestampSchema.optional(),
    updatedAt: isoTimestampSchema.optional(),
  });

export const updateBrokerOrderInputSchema = brokerOrderRecordSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export const portfolioAccountSchema = z
  .object({
    provider: z.literal("alpaca"),
    mode: tradingModeSchema,
    status: z.string(),
    cash: z.string().optional(),
    buyingPower: z.string().optional(),
    portfolioValue: z.string().optional(),
    equity: z.string().optional(),
    lastEquity: z.string().optional(),
    unrealizedPl: z.string().optional(),
    daytradeCount: z.number().optional(),
    patternDayTrader: z.boolean().optional(),
    tradeSuspendedByUser: z.boolean().optional(),
    accountBlocked: z.boolean().optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const portfolioPositionSchema = z
  .object({
    symbol: z.string(),
    qty: z.string(),
    side: z.string().optional(),
    avgEntryPrice: z.string().optional(),
    currentPrice: z.string().optional(),
    marketValue: z.string().optional(),
    costBasis: z.string().optional(),
    unrealizedPl: z.string().optional(),
    unrealizedPlpc: z.string().optional(),
    unrealizedIntradayPl: z.string().optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const portfolioSnapshotSchema = z
  .object({
    mode: tradingModeSchema,
    generatedAt: isoTimestampSchema,
    account: portfolioAccountSchema.optional(),
    positions: z.array(portfolioPositionSchema),
    orders: z.array(z.record(z.string(), z.unknown())),
    tradeIntents: z.array(tradeIntentSchema),
    messages: z.array(kairosMessageSchema),
    error: z.string().optional(),
  })
  .strict();

export type KairosTradingConfig = z.infer<typeof kairosTradingConfigSchema>;
export type TradingMode = z.infer<typeof tradingModeSchema>;
export type TradeIntent = z.infer<typeof tradeIntentSchema>;
export type CreateTradeIntentInput = z.infer<typeof createTradeIntentInputSchema>;
export type UpdateTradeIntentInput = z.infer<typeof updateTradeIntentInputSchema>;
export type KairosMessage = z.infer<typeof kairosMessageSchema>;
export type CreateKairosMessageInput = z.infer<typeof createKairosMessageInputSchema>;
export type BrokerOrderRecord = z.infer<typeof brokerOrderRecordSchema>;
export type CreateBrokerOrderInput = z.infer<typeof createBrokerOrderInputSchema>;
export type UpdateBrokerOrderInput = z.infer<typeof updateBrokerOrderInputSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;

export function createTradeIntent(
  input: CreateTradeIntentInput,
  options: { id?: () => string; now?: () => Date } = {},
): TradeIntent {
  const now = (options.now?.() ?? new Date()).toISOString();
  return tradeIntentSchema.parse({
    ...input,
    id: input.id ?? options.id?.() ?? randomUUID(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  });
}

export function createKairosMessage(
  input: CreateKairosMessageInput,
  options: { id?: () => string; now?: () => Date } = {},
): KairosMessage {
  return kairosMessageSchema.parse({
    ...input,
    id: input.id ?? options.id?.() ?? randomUUID(),
    createdAt: input.createdAt ?? (options.now?.() ?? new Date()).toISOString(),
  });
}

export function createBrokerOrderRecord(
  input: CreateBrokerOrderInput,
  options: { id?: () => string; now?: () => Date } = {},
): BrokerOrderRecord {
  const now = (options.now?.() ?? new Date()).toISOString();
  return brokerOrderRecordSchema.parse({
    ...input,
    id: input.id ?? options.id?.() ?? randomUUID(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  });
}
