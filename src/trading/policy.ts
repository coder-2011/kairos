import type { KairosBranchAgentConfig } from "../global/agent-config.js";
import type { TradingConfig } from "./schemas.js";

export type ThresholdActionResult =
  | "below_thresholds"
  | "message_human"
  | "paper_trade_candidate";

export type PermittedTradingAction =
  | "record_only"
  | "message_human"
  | "paper_buy_intent"
  | "paper_order";

export type ThresholdPolicyResult = {
  confidenceScore: number;
  notifyThreshold: number;
  paperThreshold: number;
  thresholdResult: ThresholdActionResult;
  permittedAction: PermittedTradingAction;
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
  const paperAutoBuyEnabled =
    input.tradingConfig?.paperAutoBuyEnabled ??
    branchConfig?.trading?.paperAutoBuyEnabled ??
    false;
  const notifyOnBuySignal =
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
        permittedAction: notifyOnBuySignal ? "message_human" : "record_only",
        paperAutoBuyEnabled: false,
        rationale: "Confidence crossed the paper threshold, but paper trading is disabled.",
      };
    }

    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      paperThreshold,
      thresholdResult: "paper_trade_candidate",
      permittedAction: paperAutoBuyEnabled ? "paper_order" : "paper_buy_intent",
      paperAutoBuyEnabled,
      rationale: paperAutoBuyEnabled
        ? "Confidence crossed the paper threshold and branch trading config allows paper auto-buy."
        : "Confidence crossed the paper threshold, but paper auto-buy is disabled.",
    };
  }

  if (input.confidence >= notifyThreshold) {
    return {
      confidenceScore: input.confidence,
      notifyThreshold,
      paperThreshold,
      thresholdResult: "message_human",
      permittedAction: notifyOnBuySignal ? "message_human" : "record_only",
      paperAutoBuyEnabled,
      rationale: notifyOnBuySignal
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
    paperAutoBuyEnabled,
    rationale: "Confidence stayed below configured action thresholds.",
  };
}
