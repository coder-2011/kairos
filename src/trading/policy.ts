import type { KairosBranchAgentConfig } from "../global/agent-config.js";
import type { TradingConfig } from "./schemas.js";

export type ThresholdActionResult =
  | "below_thresholds"
  | "message_human"
  | "paper_trade_candidate";

export type PermittedTradingAction =
  | "record_only"
  | "message_human"
  | "paper_trade_intent"
  | "paper_order";

export type ThresholdPolicyResult = {
  confidenceScore: number;
  notifyThreshold: number;
  tradeThreshold: number;
  paperThreshold: number;
  thresholdResult: ThresholdActionResult;
  permittedAction: PermittedTradingAction;
  autoTradeEnabled: boolean;
  paperAutoTradeEnabled: boolean;
  paperAutoBuyEnabled: boolean;
  rationale: string;
};

export type ThresholdPolicyInput = {
  confidence: number;
  tradingConfig?: TradingConfig;
  branchConfig?: KairosBranchAgentConfig;
};

const DEFAULT_NOTIFY_THRESHOLD = 0.65;
const DEFAULT_PAPER_THRESHOLD = 0.85;

export function evaluateTradingThresholdPolicy(
  input: ThresholdPolicyInput,
): ThresholdPolicyResult {
  const branchConfig = input.branchConfig as
    | (KairosBranchAgentConfig & { trading?: TradingConfig })
    | undefined;
  const notifyThreshold =
    input.tradingConfig?.notifyConfidenceThreshold ??
    branchConfig?.trading?.notifyConfidenceThreshold ??
    input.branchConfig?.thresholds?.notifyConfidence ??
    DEFAULT_NOTIFY_THRESHOLD;
  const tradeThreshold =
    input.tradingConfig?.tradeConfidenceThreshold ??
    branchConfig?.trading?.tradeConfidenceThreshold ??
    input.tradingConfig?.paperTradeConfidenceThreshold ??
    branchConfig?.trading?.paperTradeConfidenceThreshold ??
    input.branchConfig?.thresholds?.paperTradeDraftConfidence ??
    input.branchConfig?.thresholds?.buyConfidence ??
    DEFAULT_PAPER_THRESHOLD;
  const tradingMode =
    input.tradingConfig?.mode ??
    branchConfig?.trading?.mode ??
    "disabled";
  const autoTradeEnabled =
    input.tradingConfig?.autoTradeEnabled ??
    branchConfig?.trading?.autoTradeEnabled ??
    input.tradingConfig?.paperAutoBuyEnabled ??
    branchConfig?.trading?.paperAutoBuyEnabled ??
    false;
  const notifyOnTradeSignal =
    input.tradingConfig?.notifyOnBuySignal ??
    branchConfig?.trading?.notifyOnBuySignal ??
    true;

  if (input.confidence >= tradeThreshold) {
    if (tradingMode !== "enabled" && tradingMode !== "paper") {
      return {
        confidenceScore: input.confidence,
        notifyThreshold,
        tradeThreshold,
        paperThreshold: tradeThreshold,
        thresholdResult: "paper_trade_candidate",
        permittedAction: notifyOnTradeSignal ? "message_human" : "record_only",
        autoTradeEnabled: false,
        paperAutoTradeEnabled: false,
        paperAutoBuyEnabled: false,
        rationale: "Confidence crossed the trading threshold, but trading is disabled.",
      };
    }

    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      tradeThreshold,
      paperThreshold: tradeThreshold,
      thresholdResult: "paper_trade_candidate",
      permittedAction: autoTradeEnabled ? "paper_order" : "paper_trade_intent",
      autoTradeEnabled,
      paperAutoTradeEnabled: autoTradeEnabled,
      paperAutoBuyEnabled: autoTradeEnabled,
      rationale: autoTradeEnabled
        ? "Confidence crossed the trading threshold and branch trading config allows auto-submit."
        : "Confidence crossed the trading threshold, but auto-submit is disabled.",
    };
  }

  if (input.confidence >= notifyThreshold) {
    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      tradeThreshold,
      paperThreshold: tradeThreshold,
      thresholdResult: "message_human",
      permittedAction: notifyOnTradeSignal ? "message_human" : "record_only",
      autoTradeEnabled,
      paperAutoTradeEnabled: autoTradeEnabled,
      paperAutoBuyEnabled: autoTradeEnabled,
      rationale: notifyOnTradeSignal
        ? "Confidence crossed the notify threshold but stayed below the trading threshold."
        : "Confidence crossed the notify threshold, but branch notifications are disabled.",
    };
  }

  return {
    confidenceScore: input.confidence,
    notifyThreshold,
    tradeThreshold,
    paperThreshold: tradeThreshold,
    thresholdResult: "below_thresholds",
    permittedAction: "record_only",
    autoTradeEnabled,
    paperAutoTradeEnabled: autoTradeEnabled,
    paperAutoBuyEnabled: autoTradeEnabled,
    rationale: "Confidence stayed below configured action thresholds.",
  };
}
