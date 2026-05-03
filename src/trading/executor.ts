import type { AlpacaTradingClient } from "../api/alpaca.js";
import type { TradeIntent, KairosTradingConfig } from "./schema.js";

export type PaperOrderDraft = {
  symbol: string;
  side: "buy";
  type: "market";
  time_in_force: "day";
  notional: string;
  client_order_id: string;
};

export type PaperOrderPreflightResult = {
  ok: boolean;
  reasons: string[];
  account?: Record<string, unknown>;
  asset?: Record<string, unknown>;
  clock?: Record<string, unknown>;
};

export async function preflightPaperOrder(input: {
  client: AlpacaTradingClient;
  intent: TradeIntent;
  tradingConfig: KairosTradingConfig;
  openPositionMarketValue?: number;
}): Promise<PaperOrderPreflightResult> {
  const reasons: string[] = [];

  if (input.intent.mode !== "paper") {
    reasons.push("Only paper order submission is supported.");
  }

  if (!input.intent.autoBuyEnabled) {
    reasons.push("Paper auto-buy is disabled for this trade intent.");
  }

  if (input.tradingConfig.mode !== "paper") {
    reasons.push("Branch trading mode is not paper.");
  }

  if (!input.client.configured) {
    reasons.push("Alpaca paper credentials are not configured.");
  }

  let account: Record<string, unknown> | undefined;
  let asset: Record<string, unknown> | undefined;
  let clock: Record<string, unknown> | undefined;

  if (reasons.length === 0) {
    try {
      [account, asset, clock] = await Promise.all([
        input.client.getAccount(),
        input.client.getAsset(input.intent.symbol),
        input.client.getClock(),
      ]);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "Alpaca preflight failed.");
    }
  }

  if (account) {
    if (String(account.status ?? "").toUpperCase() !== "ACTIVE") {
      reasons.push(`Alpaca account is not active: ${String(account.status ?? "unknown")}.`);
    }
    if (account.account_blocked === true) {
      reasons.push("Alpaca account is blocked.");
    }
    if (account.trade_suspended_by_user === true) {
      reasons.push("Alpaca trading is suspended by user.");
    }
    const buyingPower = Number(account.buying_power ?? account.cash ?? 0);
    if (Number.isFinite(buyingPower) && buyingPower < input.intent.notional) {
      reasons.push(`Buying power ${buyingPower} is below order notional ${input.intent.notional}.`);
    }
  }

  if (asset) {
    if (asset.tradable !== true) {
      reasons.push(`${input.intent.symbol} is not tradable on Alpaca.`);
    }
    if (asset.status && String(asset.status).toLowerCase() !== "active") {
      reasons.push(`${input.intent.symbol} asset status is ${String(asset.status)}.`);
    }
  }

  if (clock && clock.is_open !== true && !input.tradingConfig.allowQueuedOrdersWhenMarketClosed) {
    reasons.push("Market is closed and queued orders are disabled.");
  }

  const projectedSymbolValue =
    (input.openPositionMarketValue ?? 0) + input.intent.notional;
  if (projectedSymbolValue > input.tradingConfig.maxOpenPositionNotionalPerSymbol) {
    reasons.push(
      `Projected ${input.intent.symbol} exposure ${projectedSymbolValue} exceeds max ${input.tradingConfig.maxOpenPositionNotionalPerSymbol}.`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    account,
    asset,
    clock,
  };
}

export function buildPaperOrderDraft(intent: TradeIntent): PaperOrderDraft {
  if (intent.orderType !== "market") {
    throw new Error("Only market paper orders are supported in the first execution path.");
  }

  return {
    symbol: intent.symbol,
    side: "buy",
    type: "market",
    time_in_force: "day",
    notional: intent.notional.toFixed(2),
    client_order_id: `kairos_${intent.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48),
  };
}
