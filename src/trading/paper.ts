import { AlpacaTradingClient } from "../api/alpaca.js";
import {
  brokerOrderSchema,
  type BrokerOrder,
  type PortfolioSnapshot,
  type TradeIntent,
  type TradingConfig,
} from "./schemas.js";

export type PaperTradingBroker = {
  getPortfolioSnapshot(): Promise<PortfolioSnapshot>;
  getClock(): Promise<{ is_open?: boolean; next_open?: string }>;
  getAsset(symbol: string): Promise<{ tradable?: boolean; status?: string }>;
  submitPaperOrder(input: {
    symbol: string;
    side: TradeIntent["side"];
    type: TradeIntent["orderType"];
    timeInForce: TradeIntent["timeInForce"];
    qty?: number;
    notional?: number;
    limitPrice?: number;
    clientOrderId?: string;
  }): Promise<BrokerOrder>;
};

export type PaperOrderPreflightResult = {
  ok: boolean;
  reasons: string[];
};

export function createAlpacaPaperBroker(): PaperTradingBroker {
  return new AlpacaTradingClient();
}

export async function preflightPaperOrder(
  broker: PaperTradingBroker,
  intent: TradeIntent,
  config: TradingConfig = {},
): Promise<PaperOrderPreflightResult> {
  const reasons: string[] = [];

  if (intent.mode !== "paper") {
    reasons.push("Only paper trade intents can be submitted.");
  }
  if (intent.side !== "buy") {
    reasons.push("This backend slice only supports paper buy orders.");
  }
  if (config.allowedSymbols && !config.allowedSymbols.includes(intent.symbol)) {
    reasons.push(`${intent.symbol} is not in the configured allowedSymbols list.`);
  }
  if (config.maxNotionalUsd && estimatedNotional(intent) > config.maxNotionalUsd) {
    reasons.push(`Intent exceeds maxNotionalUsd ${config.maxNotionalUsd}.`);
  }

  const [clock, asset, portfolio] = await Promise.all([
    broker.getClock(),
    broker.getAsset(intent.symbol),
    broker.getPortfolioSnapshot(),
  ]);

  if (clock.is_open !== true) {
    reasons.push(clock.next_open
      ? `Market is closed. Next open: ${clock.next_open}.`
      : "Market is closed.");
  }
  if (asset.tradable !== true) {
    reasons.push(`${intent.symbol} is not tradable on Alpaca.`);
  }

  const buyingPower = portfolio.account.buyingPower;
  const notional = estimatedNotional(intent);
  if (buyingPower !== undefined && notional > buyingPower) {
    reasons.push(`Insufficient buying power: need ${notional}, have ${buyingPower}.`);
  }
  if (
    intent.side === "buy" &&
    portfolio.account.equity !== undefined &&
    portfolio.account.equity < 25_000 &&
    (portfolio.account.daytradeCount ?? 0) >= 3
  ) {
    reasons.push("PDT restriction: account has used at least 3 day trades with equity below 25000.");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export async function submitPaperOrder(
  broker: PaperTradingBroker,
  intent: TradeIntent,
  config: TradingConfig = {},
): Promise<{ preflight: PaperOrderPreflightResult; order?: BrokerOrder }> {
  const preflight = await preflightPaperOrder(broker, intent, config);
  if (!preflight.ok) {
    return { preflight };
  }

  const order = await broker.submitPaperOrder({
    symbol: intent.symbol,
    side: intent.side,
    type: intent.orderType,
    timeInForce: intent.timeInForce,
    qty: intent.qty,
    notional: intent.notional,
    limitPrice: intent.limitPrice,
    clientOrderId: `kairos_${intent.id}`,
  });

  return {
    preflight,
    order: brokerOrderSchema.parse({
      ...order,
      tradeIntentId: intent.id,
      clientOrderId: order.clientOrderId || `kairos_${intent.id}`,
    }),
  };
}

function estimatedNotional(intent: TradeIntent): number {
  if (intent.notional !== undefined) return intent.notional;
  if (intent.qty !== undefined && intent.limitPrice !== undefined) {
    return intent.qty * intent.limitPrice;
  }
  return 0;
}
