import { AlpacaTradingClient } from "../api/alpaca.js";
import {
  brokerOrderSchema,
  type BrokerOrder,
  type PortfolioSnapshot,
  type TradeIntent,
  type TradingConfig,
} from "./schemas.js";

export type TradingBroker = {
  getPortfolioSnapshot(): Promise<PortfolioSnapshot>;
  getClock(): Promise<{ is_open?: boolean; next_open?: string }>;
  getAsset(symbol: string): Promise<{ tradable?: boolean; status?: string }>;
  listPaperOrders?(input?: {
    status?: "open" | "closed" | "all";
    limit?: number;
  }): Promise<BrokerOrder[]>;
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

export type PaperTradingBroker = TradingBroker;

export type PaperOrderPreflightResult = {
  ok: boolean;
  reasons: string[];
};

export function createAlpacaTradingBroker(): TradingBroker {
  return new AlpacaTradingClient();
}

export const createAlpacaPaperBroker = createAlpacaTradingBroker;

export async function preflightOrder(
  broker: TradingBroker,
  intent: TradeIntent,
  config: TradingConfig = {},
): Promise<PaperOrderPreflightResult> {
  const reasons: string[] = [];
  const notional = estimatedNotional(intent);

  if (intent.mode !== "paper") {
    reasons.push("Only broker-backed trade intents can be submitted.");
  }
  if (config.allowedSymbols && !config.allowedSymbols.includes(intent.symbol)) {
    reasons.push(`${intent.symbol} is not in the configured allowedSymbols list.`);
  }
  const maxOrderNotional = config.maxNotionalPerOrder ?? config.maxNotionalUsd;
  if (maxOrderNotional !== undefined && notional > maxOrderNotional) {
    reasons.push(`Intent exceeds configured max order notional ${maxOrderNotional}.`);
  }
  if (config.allowedOrderType !== undefined && intent.orderType !== config.allowedOrderType) {
    reasons.push(`Intent order type ${intent.orderType} does not match configured allowedOrderType ${config.allowedOrderType}.`);
  }

  const [clock, asset, portfolio] = await Promise.all([
    broker.getClock(),
    broker.getAsset(intent.symbol),
    broker.getPortfolioSnapshot(),
  ]);

  if (clock.is_open !== true && config.allowQueuedOrdersWhenMarketClosed !== true) {
    reasons.push(clock.next_open
      ? `Market is closed. Next open: ${clock.next_open}.`
      : "Market is closed.");
  }
  if (asset.tradable !== true) {
    reasons.push(`${intent.symbol} is not tradable on Alpaca.`);
  }

  if (intent.side === "buy") {
    const buyingPower = portfolio.account.buyingPower;
    if (buyingPower !== undefined && notional > buyingPower) {
      reasons.push(`Insufficient buying power: need ${notional}, have ${buyingPower}.`);
    }
    const maxPositionNotional = config.maxOpenPositionNotionalPerSymbol;
    if (maxPositionNotional !== undefined) {
      const position = findPortfolioPosition(portfolio, intent.symbol);
      const currentPositionNotional = estimatedPositionNotional(position);
      if (currentPositionNotional + notional > maxPositionNotional) {
        reasons.push(
          `Intent would exceed configured max open position notional ${maxPositionNotional} for ${intent.symbol}.`,
        );
      }
    }
  }
  if (intent.side === "sell") {
    const position = findPortfolioPosition(portfolio, intent.symbol);
    const heldQty = position?.qty ?? 0;
    const requestedQty = estimatedSellQuantity(intent, position?.currentPrice);
    if (heldQty <= 0) {
      reasons.push(`No known ${intent.symbol} position is available to sell.`);
    } else if (requestedQty === undefined) {
      reasons.push(`Cannot verify ${intent.symbol} sell quantity from the trade intent.`);
    } else if (requestedQty > heldQty) {
      reasons.push(`Sell quantity ${requestedQty} exceeds known ${intent.symbol} position ${heldQty}.`);
    }
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

export const preflightPaperOrder = preflightOrder;

function findPortfolioPosition(
  portfolio: PortfolioSnapshot,
  symbol: string,
): PortfolioSnapshot["positions"][number] | undefined {
  return portfolio.positions.find(
    (item) => item.symbol.toUpperCase() === symbol.toUpperCase(),
  );
}

function estimatedPositionNotional(
  position: PortfolioSnapshot["positions"][number] | undefined,
): number {
  if (!position) return 0;
  if (position.marketValue !== undefined) return Math.abs(position.marketValue);
  if (position.currentPrice !== undefined) return Math.abs(position.qty * position.currentPrice);
  return 0;
}

export async function submitOrder(
  broker: TradingBroker,
  intent: TradeIntent,
  config: TradingConfig = {},
): Promise<{ preflight: PaperOrderPreflightResult; order?: BrokerOrder }> {
  const preflight = await preflightOrder(broker, intent, config);
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

export const submitPaperOrder = submitOrder;

function estimatedNotional(intent: TradeIntent): number {
  if (intent.notional !== undefined) return intent.notional;
  if (intent.qty !== undefined && intent.limitPrice !== undefined) {
    return intent.qty * intent.limitPrice;
  }
  return 0;
}

function estimatedSellQuantity(
  intent: TradeIntent,
  currentPrice: number | undefined,
): number | undefined {
  if (intent.qty !== undefined) return intent.qty;
  if (intent.notional !== undefined && currentPrice !== undefined && currentPrice > 0) {
    return intent.notional / currentPrice;
  }
  return undefined;
}
