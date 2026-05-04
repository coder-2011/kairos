import { describe, expect, it } from "vitest";

import { evaluateTradingThresholdPolicy } from "./policy.js";

describe("evaluateTradingThresholdPolicy", () => {
  it("uses buyConfidence as the canonical branch trading threshold", () => {
    const result = evaluateTradingThresholdPolicy({
      confidence: 0.86,
      branchConfig: {
        thresholds: {
          buyConfidence: 0.85,
          paperTradeDraftConfidence: 0.95,
        },
      },
    });

    expect(result.tradeThreshold).toBe(0.85);
    expect(result.thresholdResult).toBe("paper_trade_candidate");
  });

  it("keeps legacy paperTradeDraftConfidence configs readable", () => {
    const result = evaluateTradingThresholdPolicy({
      confidence: 0.86,
      branchConfig: {
        thresholds: {
          paperTradeDraftConfidence: 0.85,
        },
      },
    });

    expect(result.tradeThreshold).toBe(0.85);
    expect(result.thresholdResult).toBe("paper_trade_candidate");
  });
});
