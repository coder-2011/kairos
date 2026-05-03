import { describe, expect, it } from "vitest";

import { preflightPaperOrder, type PaperTradingBroker } from "./paper.js";
import {
  createTradeIntentRecord,
  type CreateTradeIntentInput,
  type PortfolioSnapshot,
} from "./schemas.js";

describe("preflightPaperOrder", () => {
  it("honors allowQueuedOrdersWhenMarketClosed", async () => {
    const result = await preflightPaperOrder(
      createMockBroker({ clock: { is_open: false, next_open: "2026-05-04T13:30:00Z" } }),
      createIntent(),
      { allowQueuedOrdersWhenMarketClosed: true },
    );

    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it("blocks closed-market orders unless queueing is explicitly allowed", async () => {
    const result = await preflightPaperOrder(
      createMockBroker({ clock: { is_open: false, next_open: "2026-05-04T13:30:00Z" } }),
      createIntent(),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("Market is closed. Next open: 2026-05-04T13:30:00Z.");
  });

  it("uses maxNotionalPerOrder as the paper order cap", async () => {
    const result = await preflightPaperOrder(
      createMockBroker(),
      createIntent({ notional: 600 }),
      { maxNotionalPerOrder: 500 },
    );

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("Intent exceeds configured max order notional 500.");
  });

  it("enforces maxOpenPositionNotionalPerSymbol for buys", async () => {
    const result = await preflightPaperOrder(
      createMockBroker({
        portfolio: {
          ...basePortfolioSnapshot(),
          positions: [{ symbol: "PLTR", qty: 10, marketValue: 250, currentPrice: 25 }],
        },
      }),
      createIntent({ notional: 300 }),
      { maxOpenPositionNotionalPerSymbol: 500 },
    );

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      "Intent would exceed configured max open position notional 500 for PLTR.",
    );
  });

});

function createIntent(overrides: Partial<CreateTradeIntentInput> = {}) {
  const { evidence, ...rest } = overrides;

  return createTradeIntentRecord(
    {
      symbol: "PLTR",
      side: "buy",
      notional: 500,
      confidence: 0.9,
      evidence: evidence ?? [],
      reasoning: "Debate found a material contract catalyst.",
      expectedCatalyst: "New material contract.",
      risk: "Market may have priced in the news.",
      timeHorizon: "1-4 weeks",
      positionSizingRationale: "Small paper order for observation.",
      invalidationCondition: "Contract report is contradicted.",
      exitCondition: "Catalyst is priced in or thesis breaks.",
      ...rest,
    },
    {
      id: () => "intent_1",
      now: () => new Date("2026-05-03T12:00:00.000Z"),
    },
  );
}

function createMockBroker(options: {
  clock?: Awaited<ReturnType<PaperTradingBroker["getClock"]>>;
  asset?: Awaited<ReturnType<PaperTradingBroker["getAsset"]>>;
  portfolio?: PortfolioSnapshot;
} = {}): PaperTradingBroker {
  return {
    async getPortfolioSnapshot() {
      return options.portfolio ?? basePortfolioSnapshot();
    },
    async getClock() {
      return options.clock ?? { is_open: true };
    },
    async getAsset() {
      return options.asset ?? { tradable: true, status: "active" };
    },
    async submitPaperOrder() {
      throw new Error("submitPaperOrder should not be called during preflight tests.");
    },
  };
}

function basePortfolioSnapshot(): PortfolioSnapshot {
  return {
    id: "portfolio_1",
    capturedAt: "2026-05-03T12:00:00.000Z",
    provider: "alpaca",
    environment: "paper",
    account: {
      status: "ACTIVE",
      cash: 100000,
      buyingPower: 100000,
      portfolioValue: 100000,
      equity: 100000,
      daytradeCount: 0,
    },
    positions: [],
  };
}
