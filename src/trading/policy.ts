import type { KairosBranchAgentConfig } from "../global/agent-config.js";
import {
  kairosTradingConfigSchema,
  type CreateKairosMessageInput,
  type CreateTradeIntentInput,
  type KairosTradingConfig,
} from "./schema.js";

export type TradingDecisionInput = {
  branchId?: string;
  runId?: string;
  lawId?: string;
  branchConfig?: KairosBranchAgentConfig;
  summary: string;
  confidence: number;
  citations?: Array<Record<string, unknown>>;
  symbol?: string;
  metadata?: Record<string, unknown>;
};

export type TradingDecisionPlan = {
  action: "record_only" | "message_human" | "paper_trade_intent" | "paper_order_submit";
  tradingConfig: KairosTradingConfig;
  notifyThreshold: number;
  paperTradeThreshold: number;
  message?: CreateKairosMessageInput;
  tradeIntent?: CreateTradeIntentInput;
  rationale: string;
};

export function planTradingDecision(input: TradingDecisionInput): TradingDecisionPlan {
  const tradingConfig = kairosTradingConfigSchema.parse(input.branchConfig?.trading ?? {});
  const thresholds = input.branchConfig?.thresholds ?? {};
  const notifyThreshold = thresholds.notifyConfidence ?? 0.65;
  const paperTradeThreshold =
    thresholds.paperTradeDraftConfidence ?? thresholds.buyConfidence ?? 0.85;
  const confidence = clampConfidence(input.confidence);
  const symbol = normalizeSymbol(input.symbol ?? input.branchConfig?.assets?.[0]);

  if (confidence < notifyThreshold) {
    return {
      action: "record_only",
      tradingConfig,
      notifyThreshold,
      paperTradeThreshold,
      rationale: `Confidence ${confidence} is below notify threshold ${notifyThreshold}.`,
    };
  }

  const baseMessage: CreateKairosMessageInput = {
    branchId: input.branchId,
    runId: input.runId,
    level: confidence >= paperTradeThreshold ? "action" : "info",
    title:
      confidence >= paperTradeThreshold
        ? "Buy signal crossed paper threshold"
        : "Trading signal crossed notify threshold",
    body: input.summary,
    metadata: {
      confidence,
      notifyThreshold,
      paperTradeThreshold,
      actionSource: "threshold_policy",
      ...input.metadata,
    },
  };

  if (confidence < paperTradeThreshold) {
    return {
      action: tradingConfig.notifyOnBuySignal ? "message_human" : "record_only",
      tradingConfig,
      notifyThreshold,
      paperTradeThreshold,
      message: tradingConfig.notifyOnBuySignal ? baseMessage : undefined,
      rationale: `Confidence ${confidence} reached notify threshold but not paper trade threshold.`,
    };
  }

  if (tradingConfig.mode !== "paper" || !symbol) {
    return {
      action: tradingConfig.notifyOnBuySignal ? "message_human" : "record_only",
      tradingConfig,
      notifyThreshold,
      paperTradeThreshold,
      message: tradingConfig.notifyOnBuySignal ? baseMessage : undefined,
      rationale:
        tradingConfig.mode !== "paper"
          ? "Paper trading is disabled for this branch."
          : "No tradable symbol is configured for this branch.",
    };
  }

  const tradeIntent: CreateTradeIntentInput = {
    branchId: input.branchId,
    runId: input.runId,
    lawId: input.lawId,
    symbol,
    side: "buy",
    mode: "paper",
    status: tradingConfig.paperAutoBuyEnabled
      ? "pending_preflight"
      : "message_only",
    action: tradingConfig.paperAutoBuyEnabled
      ? "paper_order_submit"
      : "paper_trade_intent",
    confidence,
    notifyThreshold,
    paperTradeThreshold,
    summary: input.summary,
    rationale: tradingConfig.paperAutoBuyEnabled
      ? "Paper auto-buy is enabled and confidence crossed the paper trade threshold."
      : "Paper auto-buy is disabled, so this remains a trade intent and message.",
    citations: input.citations ?? [],
    notional: tradingConfig.maxNotionalPerOrder,
    orderType: tradingConfig.allowedOrderType,
    autoBuyEnabled: tradingConfig.paperAutoBuyEnabled,
    requiredApproval: !tradingConfig.paperAutoBuyEnabled,
    metadata: input.metadata,
  };

  return {
    action: tradingConfig.paperAutoBuyEnabled
      ? "paper_order_submit"
      : "paper_trade_intent",
    tradingConfig,
    notifyThreshold,
    paperTradeThreshold,
    message: tradingConfig.notifyOnBuySignal
      ? {
          ...baseMessage,
          tradeIntentId: tradeIntent.id,
        }
      : undefined,
    tradeIntent,
    rationale: tradeIntent.rationale ?? "",
  };
}

function normalizeSymbol(symbol: string | undefined): string | undefined {
  const normalized = symbol?.trim().toUpperCase();
  return normalized || undefined;
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}
