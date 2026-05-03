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
  paperThreshold: number;
  thresholdResult: ThresholdActionResult;
  permittedAction: PermittedTradingAction;
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
  const paperThreshold =
    input.tradingConfig?.paperTradeConfidenceThreshold ??
    branchConfig?.trading?.paperTradeConfidenceThreshold ??
    input.branchConfig?.thresholds?.paperTradeDraftConfidence ??
    input.branchConfig?.thresholds?.buyConfidence ??
    DEFAULT_PAPER_THRESHOLD;
  const tradingMode =
    input.tradingConfig?.mode ??
    branchConfig?.trading?.mode ??
    "disabled";
  const paperAutoTradeEnabled =
    input.tradingConfig?.paperAutoBuyEnabled ??
    branchConfig?.trading?.paperAutoBuyEnabled ??
    false;
  const notifyOnTradeSignal =
    input.tradingConfig?.notifyOnBuySignal ??
    branchConfig?.trading?.notifyOnBuySignal ??
    true;

  if (input.confidence >= paperThreshold) {
    if (tradingMode !== "paper") {
      return {
        confidenceScore: input.confidence,
        notifyThreshold,
        paperThreshold,
        thresholdResult: "paper_trade_candidate",
        permittedAction: notifyOnTradeSignal ? "message_human" : "record_only",
        paperAutoTradeEnabled: false,
        paperAutoBuyEnabled: false,
        rationale: "Confidence crossed the paper threshold, but paper trading is disabled.",
      };
    }

    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      paperThreshold,
      thresholdResult: "paper_trade_candidate",
      permittedAction: paperAutoTradeEnabled ? "paper_order" : "paper_trade_intent",
      paperAutoTradeEnabled,
      paperAutoBuyEnabled: paperAutoTradeEnabled,
      rationale: paperAutoTradeEnabled
        ? "Confidence crossed the paper threshold and branch trading config allows paper auto-trading."
        : "Confidence crossed the paper threshold, but paper auto-trading is disabled.",
    };
  }

  if (input.confidence >= notifyThreshold) {
    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      paperThreshold,
      thresholdResult: "message_human",
      permittedAction: notifyOnTradeSignal ? "message_human" : "record_only",
      paperAutoTradeEnabled,
      paperAutoBuyEnabled: paperAutoTradeEnabled,
      rationale: notifyOnTradeSignal
        ? "Confidence crossed the notify threshold but stayed below the paper threshold."
        : "Confidence crossed the notify threshold, but branch notifications are disabled.",
    };
  }

  return {
    confidenceScore: input.confidence,
    notifyThreshold,
    paperThreshold,
    thresholdResult: "below_thresholds",
    permittedAction: "record_only",
    paperAutoTradeEnabled,
    paperAutoBuyEnabled: paperAutoTradeEnabled,
    rationale: "Confidence stayed below configured action thresholds.",
  };
}
