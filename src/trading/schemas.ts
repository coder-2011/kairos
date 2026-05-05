import { randomUUID } from "node:crypto";

import { z } from "zod";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const confidenceSchema = z.number().min(0).max(1);
const moneySchema = z.number().positive();

export const tradingSideSchema = z.enum(["buy", "sell"]);
export const brokerOrderTypeSchema = z.enum(["market", "limit"]);
export const brokerTimeInForceSchema = z.enum(["day", "gtc", "opg", "cls", "ioc", "fok"]);
export const tradeIntentStatusSchema = z.enum([
  "draft",
  "paper_ready",
  "paper_submitted",
  "blocked",
  "canceled",
]);
export const brokerOrderStatusSchema = z.enum([
  "new",
  "accepted",
  "pending_new",
  "partially_filled",
  "filled",
  "done_for_day",
  "canceled",
  "expired",
  "replaced",
  "pending_cancel",
  "pending_replace",
  "accepted_for_bidding",
  "stopped",
  "rejected",
  "suspended",
  "calculated",
  "failed",
  "unknown",
]);

export const tradingConfigSchema = z
  .object({
    mode: z.enum(["disabled", "enabled", "paper"]).optional(),
    symbol: z.string().min(1).optional(),
    symbols: z.array(z.string().min(1)).optional(),
    autoTradeEnabled: z.boolean().optional(),
    paperAutoBuyEnabled: z.boolean().optional(),
    notifyOnBuySignal: z.boolean().optional(),
    maxNotionalPerOrder: moneySchema.optional(),
    maxOpenPositionNotionalPerSymbol: moneySchema.optional(),
    allowedOrderType: brokerOrderTypeSchema.optional(),
    allowQueuedOrdersWhenMarketClosed: z.boolean().optional(),
    notifyConfidenceThreshold: confidenceSchema.optional(),
    tradeConfidenceThreshold: confidenceSchema.optional(),
    paperTradeConfidenceThreshold: confidenceSchema.optional(),
    maxNotionalUsd: moneySchema.optional(),
    defaultOrderType: brokerOrderTypeSchema.optional(),
    defaultTimeInForce: brokerTimeInForceSchema.optional(),
    allowedSymbols: z.array(z.string().min(1)).optional(),
  })
  .strict();

const tradeIntentBaseSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    status: tradeIntentStatusSchema,
    mode: z.literal("paper"),
    branchId: z.string().min(1).optional(),
    lawId: z.string().min(1).optional(),
    sourceRunId: z.string().min(1).optional(),
    symbol: z.string().min(1),
    side: tradingSideSchema,
    orderType: brokerOrderTypeSchema,
    timeInForce: brokerTimeInForceSchema,
    qty: z.number().positive().optional(),
    notional: moneySchema.optional(),
    limitPrice: moneySchema.optional(),
    confidence: confidenceSchema,
    evidence: z.array(z.unknown()).default([]),
    reasoning: z.string().min(1),
    expectedCatalyst: z.string().min(1),
    risk: z.string().min(1),
    timeHorizon: z.string().min(1),
    positionSizingRationale: z.string().min(1),
    invalidationCondition: z.string().min(1),
    exitCondition: z.string().min(1),
    approvalsRequired: z.array(z.string().min(1)).default(["human_review"]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const tradeIntentSchema = tradeIntentBaseSchema
  .refine((intent) => intent.qty !== undefined || intent.notional !== undefined, {
    message: "Trade intent requires qty or notional.",
    path: ["qty"],
  })
  .refine((intent) => intent.orderType !== "limit" || intent.limitPrice !== undefined, {
    message: "Limit orders require limitPrice.",
    path: ["limitPrice"],
  });

export const createTradeIntentInputSchema = tradeIntentBaseSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    status: true,
    mode: true,
    orderType: true,
    timeInForce: true,
    approvalsRequired: true,
  })
  .extend({
    id: z.string().min(1).optional(),
    status: tradeIntentStatusSchema.optional(),
    mode: z.literal("paper").optional(),
    orderType: brokerOrderTypeSchema.optional(),
    timeInForce: brokerTimeInForceSchema.optional(),
    approvalsRequired: z.array(z.string().min(1)).optional(),
    tradingConfig: tradingConfigSchema.optional(),
  })
  .refine((intent) => intent.qty !== undefined || intent.notional !== undefined, {
    message: "Trade intent requires qty or notional.",
    path: ["qty"],
  })
  .refine((intent) => intent.orderType !== "limit" || intent.limitPrice !== undefined, {
    message: "Limit orders require limitPrice.",
    path: ["limitPrice"],
  });

export const updateTradeIntentInputSchema = tradeIntentBaseSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export const tradingMessageSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    type: z.enum([
      "threshold_notify",
      "paper_trade_candidate",
      "paper_order_submitted",
      "paper_order_blocked",
      "telegram_notification_sent",
      "telegram_notification_failed",
      "manual",
    ]),
    severity: z.enum(["info", "action", "warning"]),
    title: z.string().min(1),
    body: z.string().min(1),
    branchId: z.string().min(1).optional(),
    lawId: z.string().min(1).optional(),
    sourceRunId: z.string().min(1).optional(),
    tradeIntentId: z.string().min(1).optional(),
    brokerOrderId: z.string().min(1).optional(),
    confidence: confidenceSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createTradingMessageInputSchema = tradingMessageSchema.omit({
  id: true,
  createdAt: true,
});

export const brokerOrderSchema = z
  .object({
    id: z.string().min(1),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    provider: z.literal("alpaca"),
    environment: z.literal("paper"),
    tradeIntentId: z.string().min(1).optional(),
    alpacaOrderId: z.string().min(1).optional(),
    clientOrderId: z.string().min(1),
    status: brokerOrderStatusSchema,
    symbol: z.string().min(1),
    side: tradingSideSchema,
    orderType: brokerOrderTypeSchema,
    timeInForce: brokerTimeInForceSchema,
    qty: z.number().positive().optional(),
    notional: moneySchema.optional(),
    limitPrice: moneySchema.optional(),
    submittedAt: isoTimestampSchema.optional(),
    failureReason: z.string().optional(),
    raw: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createBrokerOrderInputSchema = brokerOrderSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const portfolioPositionSchema = z
  .object({
    symbol: z.string().min(1),
    qty: z.number(),
    marketValue: z.number().optional(),
    costBasis: z.number().optional(),
    unrealizedPl: z.number().optional(),
    unrealizedPlpc: z.number().optional(),
    currentPrice: z.number().optional(),
    side: z.string().optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const portfolioSnapshotSchema = z
  .object({
    id: z.string().min(1),
    capturedAt: isoTimestampSchema,
    provider: z.literal("alpaca"),
    environment: z.literal("paper"),
    account: z
      .object({
        status: z.string().optional(),
        cash: z.number().optional(),
        buyingPower: z.number().optional(),
        portfolioValue: z.number().optional(),
        equity: z.number().optional(),
        lastEquity: z.number().optional(),
        unrealizedPl: z.number().optional(),
        daytradeCount: z.number().int().optional(),
        patternDayTrader: z.boolean().optional(),
        tradingBlocked: z.boolean().optional(),
        transfersBlocked: z.boolean().optional(),
        accountBlocked: z.boolean().optional(),
        raw: z.unknown().optional(),
      })
      .strict(),
    positions: z.array(portfolioPositionSchema),
  })
  .strict();

export type TradingSide = z.infer<typeof tradingSideSchema>;
export type BrokerOrderType = z.infer<typeof brokerOrderTypeSchema>;
export type BrokerTimeInForce = z.infer<typeof brokerTimeInForceSchema>;
export type TradeIntentStatus = z.infer<typeof tradeIntentStatusSchema>;
export type BrokerOrderStatus = z.infer<typeof brokerOrderStatusSchema>;
export type TradingConfig = z.infer<typeof tradingConfigSchema>;
export type TradeIntent = z.infer<typeof tradeIntentSchema>;
export type CreateTradeIntentInput = z.infer<typeof createTradeIntentInputSchema>;
export type UpdateTradeIntentInput = z.infer<typeof updateTradeIntentInputSchema>;
export type TradingMessage = z.infer<typeof tradingMessageSchema>;
export type CreateTradingMessageInput = z.infer<typeof createTradingMessageInputSchema>;
export type BrokerOrder = z.infer<typeof brokerOrderSchema>;
export type CreateBrokerOrderInput = z.infer<typeof createBrokerOrderInputSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;

export type TradingRecordFactoryOptions = {
  id?: () => string;
  now?: () => Date;
};

export function createTradeIntentRecord(
  input: CreateTradeIntentInput,
  options: TradingRecordFactoryOptions = {},
): TradeIntent {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const parsed = createTradeIntentInputSchema.parse(input);
  const { tradingConfig, ...record } = parsed;

  return tradeIntentSchema.parse({
    ...record,
    id: parsed.id ?? id(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: parsed.status ?? "paper_ready",
    mode: parsed.mode ?? "paper",
    orderType:
      parsed.orderType ??
      tradingConfig?.defaultOrderType ??
      tradingConfig?.allowedOrderType ??
      "market",
    timeInForce: parsed.timeInForce ?? tradingConfig?.defaultTimeInForce ?? "day",
    approvalsRequired: parsed.approvalsRequired ?? ["human_review"],
  });
}

export function createTradingMessageRecord(
  input: CreateTradingMessageInput,
  options: TradingRecordFactoryOptions = {},
): TradingMessage {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return tradingMessageSchema.parse({
    ...input,
    id: id(),
    createdAt: now().toISOString(),
  });
}

export function createBrokerOrderRecord(
  input: CreateBrokerOrderInput,
  options: TradingRecordFactoryOptions = {},
): BrokerOrder {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();

  return brokerOrderSchema.parse({
    ...input,
    id: id(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createPortfolioSnapshotRecord(
  input: Omit<PortfolioSnapshot, "id" | "capturedAt"> & {
    id?: string;
    capturedAt?: string;
  },
  options: TradingRecordFactoryOptions = {},
): PortfolioSnapshot {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return portfolioSnapshotSchema.parse({
    ...input,
    id: input.id ?? id(),
    capturedAt: input.capturedAt ?? now().toISOString(),
  });
}
