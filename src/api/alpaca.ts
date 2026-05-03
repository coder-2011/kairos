import { retryFetch } from "../global/retry.js";
import {
  createPortfolioSnapshotRecord,
  type BrokerOrder,
  type BrokerOrderStatus,
  type BrokerOrderType,
  type BrokerTimeInForce,
  type PortfolioSnapshot,
  type TradingSide,
} from "../trading/schemas.js";

export const ALPACA_PAPER_BASE_URL = "https://paper-api.alpaca.markets";
export const ALPACA_MARKET_DATA_BASE_URL = "https://data.alpaca.markets";

export type AlpacaClientOptions = {
  apiKey?: string;
  secretKey?: string;
  baseUrl?: string;
  marketDataBaseUrl?: string;
  fetch?: typeof fetch;
  fetchImpl?: typeof fetch;
  retryAttempts?: number;
};

export type AlpacaConfig = AlpacaClientOptions;

export type AlpacaOrderRequest = {
  symbol: string;
  side: TradingSide;
  type: BrokerOrderType;
  timeInForce: BrokerTimeInForce;
  qty?: number;
  notional?: number;
  limitPrice?: number;
  clientOrderId?: string;
};

export type AlpacaLegacyOrderRequest = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: "day" | "gtc";
  client_order_id: string;
  notional?: string;
  qty?: string;
  limit_price?: string;
};

type AlpacaAccount = Record<string, unknown>;
type AlpacaPosition = Record<string, unknown>;
type AlpacaOrder = Record<string, unknown>;
type AlpacaClock = {
  is_open?: boolean;
  timestamp?: string;
  next_open?: string;
  next_close?: string;
};
type AlpacaAsset = {
  name?: string;
  symbol?: string;
  exchange?: string;
  tradable?: boolean;
  marginable?: boolean;
  shortable?: boolean;
  easy_to_borrow?: boolean;
  fractionable?: boolean;
  status?: string;
  asset_class?: string;
};
type AlpacaStockSnapshot = {
  latestTrade?: {
    p?: number;
    t?: string;
  };
  latestQuote?: {
    ap?: number;
    bp?: number;
    t?: string;
  };
  dailyBar?: {
    c?: number;
    h?: number;
    l?: number;
    o?: number;
    t?: string;
    v?: number;
  };
  prevDailyBar?: {
    c?: number;
  };
};
type ListOrdersInput = {
  status?: "open" | "closed" | "all";
  limit?: number;
};
export type AlpacaMarketSymbol = {
  symbol: string;
  name?: string;
  exchange?: string;
  assetClass?: string;
  tradable: boolean;
  marginable?: boolean;
  shortable?: boolean;
  easyToBorrow?: boolean;
  fractionable?: boolean;
  price?: number;
  previousClose?: number;
  dayChangePercent?: number;
  dailyVolume?: number;
  updatedAt?: string;
  source: "alpaca" | "fallback";
};
export type AlpacaMarketSymbolQuery = {
  query?: string;
  limit?: number;
};

export class AlpacaTradingClient {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly marketDataBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryAttempts: number;

  constructor(config: AlpacaClientOptions = {}) {
    this.apiKey = config.apiKey ?? process.env.ALPACA_API_KEY ?? "";
    this.secretKey = config.secretKey ?? process.env.ALPACA_SECRET_KEY ?? "";
    this.baseUrl = removeTrailingSlash(
      config.baseUrl ?? process.env.ALPACA_BASE_URL ?? ALPACA_PAPER_BASE_URL,
    );
    this.marketDataBaseUrl = removeTrailingSlash(
      config.marketDataBaseUrl ??
        process.env.ALPACA_MARKET_DATA_BASE_URL ??
        ALPACA_MARKET_DATA_BASE_URL,
    );
    this.fetchImpl = config.fetchImpl ?? config.fetch ?? fetch;
    this.retryAttempts = config.retryAttempts ?? 3;

    if (!this.apiKey || !this.secretKey) {
      throw new Error("ALPACA_API_KEY and ALPACA_SECRET_KEY are required.");
    }
    assertPaperBaseUrl(this.baseUrl);
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  get mode(): "paper" {
    return "paper";
  }

  async getAccount(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/v2/account");
  }

  async getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
    const [account, positions] = await Promise.all([
      this.request<AlpacaAccount>("GET", "/v2/account"),
      this.request<AlpacaPosition[]>("GET", "/v2/positions"),
    ]);

    return createPortfolioSnapshotRecord({
      provider: "alpaca",
      environment: "paper",
      account: {
        status: stringValue(account.status),
        cash: numberValue(account.cash),
        buyingPower: numberValue(account.buying_power),
        portfolioValue: numberValue(account.portfolio_value),
        equity: numberValue(account.equity),
        lastEquity: numberValue(account.last_equity),
        unrealizedPl: numberValue(account.unrealized_pl),
        daytradeCount: intValue(account.daytrade_count),
        patternDayTrader: boolValue(account.pattern_day_trader),
        tradingBlocked: boolValue(account.trading_blocked),
        transfersBlocked: boolValue(account.transfers_blocked),
        accountBlocked: boolValue(account.account_blocked),
        raw: account,
      },
      positions: positions.map((position) => ({
        symbol: stringValue(position.symbol) ?? "UNKNOWN",
        qty: numberValue(position.qty) ?? 0,
        marketValue: numberValue(position.market_value),
        costBasis: numberValue(position.cost_basis),
        unrealizedPl: numberValue(position.unrealized_pl),
        unrealizedPlpc: numberValue(position.unrealized_plpc),
        currentPrice: numberValue(position.current_price),
        side: stringValue(position.side),
        raw: position,
      })),
    });
  }

  getClock(): Promise<AlpacaClock> {
    return this.request<AlpacaClock>("GET", "/v2/clock");
  }

  getAsset(symbol: string): Promise<AlpacaAsset> {
    return this.request<AlpacaAsset>(
      "GET",
      `/v2/assets/${encodeURIComponent(symbol)}`,
    );
  }

  listActiveEquityAssets(): Promise<AlpacaAsset[]> {
    return this.request<AlpacaAsset[]>(
      "GET",
      "/v2/assets?status=active&asset_class=us_equity",
    );
  }

  async listMarketSymbols(
    input: AlpacaMarketSymbolQuery = {},
  ): Promise<AlpacaMarketSymbol[]> {
    const query = input.query?.trim().toUpperCase();
    const limit = Math.max(1, Math.min(input.limit ?? 500, 1000));
    const assets = await this.listActiveEquityAssets();
    const filtered = assets
      .filter((asset) => {
        const symbol = stringValue(asset.symbol);
        if (!symbol) return false;
        if (!query) return true;
        return (
          symbol.toUpperCase().includes(query) ||
          stringValue(asset.name)?.toUpperCase().includes(query)
        );
      })
      .slice(0, limit);
    const snapshots = await this.getStockSnapshots(
      filtered.map((asset) => stringValue(asset.symbol)).filter(Boolean) as string[],
    );

    return filtered.map((asset) =>
      toMarketSymbol(asset, snapshots[stringValue(asset.symbol) ?? ""]),
    );
  }

  async getStockSnapshots(
    symbols: string[],
  ): Promise<Record<string, AlpacaStockSnapshot>> {
    const normalized = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    const chunks = chunkArray(normalized, 100);
    const snapshots: Record<string, AlpacaStockSnapshot> = {};

    for (const chunk of chunks) {
      const params = new URLSearchParams();
      params.set("symbols", chunk.join(","));
      params.set("feed", process.env.ALPACA_DATA_FEED ?? "iex");
      const response = await this.marketDataRequest<
        Record<string, AlpacaStockSnapshot> | { snapshots?: Record<string, AlpacaStockSnapshot> }
      >(`/v2/stocks/snapshots?${params.toString()}`);
      Object.assign(snapshots, readSnapshotMap(response));
    }

    return snapshots;
  }

  listPositions(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>("GET", "/v2/positions");
  }

  listOrders(input: ListOrdersInput = {}): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();
    params.set("status", input.status ?? "all");
    params.set("limit", String(input.limit ?? 50));
    return this.request<Record<string, unknown>[]>(
      "GET",
      `/v2/orders?${params.toString()}`,
    );
  }

  async listPaperOrders(input: ListOrdersInput = {}): Promise<BrokerOrder[]> {
    const orders = await this.listOrders(input);
    return orders.map((order) => toBrokerOrder(order));
  }

  async submitOrder(order: AlpacaLegacyOrderRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/v2/orders", {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      time_in_force: order.time_in_force,
      client_order_id: order.client_order_id,
      qty: order.qty,
      notional: order.notional,
      limit_price: order.limit_price,
    });
  }

  async submitPaperOrder(input: AlpacaOrderRequest): Promise<BrokerOrder> {
    const order = await this.request<AlpacaOrder>("POST", "/v2/orders", {
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      time_in_force: input.timeInForce,
      qty: input.qty === undefined ? undefined : String(input.qty),
      notional: input.notional === undefined ? undefined : String(input.notional),
      limit_price: input.limitPrice === undefined ? undefined : String(input.limitPrice),
      client_order_id: input.clientOrderId,
    });

    return toBrokerOrder(order, {
      symbol: input.symbol,
      side: input.side,
      orderType: input.type,
      timeInForce: input.timeInForce,
      qty: input.qty,
      notional: input.notional,
      limitPrice: input.limitPrice,
      clientOrderId: input.clientOrderId,
    });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await retryFetch(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          "APCA-API-KEY-ID": this.apiKey,
          "APCA-API-SECRET-KEY": this.secretKey,
          "content-type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(withoutUndefined(body ?? {})) : undefined,
      },
      { attempts: this.retryAttempts },
    );

    if (!response.ok) {
      throw new Error(`Alpaca ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.text()) as T);
  }

  private async marketDataRequest<T>(path: string): Promise<T> {
    const response = await retryFetch(
      this.fetchImpl,
      `${this.marketDataBaseUrl}${path}`,
      {
        method: "GET",
        headers: {
          "APCA-API-KEY-ID": this.apiKey,
          "APCA-API-SECRET-KEY": this.secretKey,
          "content-type": "application/json",
        },
      },
      { attempts: this.retryAttempts },
    );

    if (!response.ok) {
      throw new Error(`Alpaca market data ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.text()) as T);
  }
}

export function createAlpacaTradingClient(
  options: AlpacaClientOptions = {},
): AlpacaTradingClient {
  return new AlpacaTradingClient(options);
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertPaperBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (
    url.hostname.endsWith("alpaca.markets") &&
    url.hostname !== "paper-api.alpaca.markets"
  ) {
    throw new Error("Only Alpaca paper trading endpoints are allowed.");
  }
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function intValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeOrderStatus(value: unknown): BrokerOrderStatus {
  const status = stringValue(value);
  const allowed = new Set<BrokerOrderStatus>([
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
  ]);
  return status && allowed.has(status as BrokerOrderStatus)
    ? (status as BrokerOrderStatus)
    : "unknown";
}

function normalizeSide(value: unknown): TradingSide | undefined {
  return value === "buy" || value === "sell" ? value : undefined;
}

function normalizeOrderType(value: unknown): BrokerOrderType | undefined {
  return value === "market" || value === "limit" ? value : undefined;
}

function normalizeTimeInForce(value: unknown): BrokerTimeInForce | undefined {
  return ["day", "gtc", "opg", "cls", "ioc", "fok"].includes(
    String(value),
  )
    ? (value as BrokerTimeInForce)
    : undefined;
}

function toMarketSymbol(
  asset: AlpacaAsset,
  snapshot?: AlpacaStockSnapshot,
): AlpacaMarketSymbol {
  const price =
    numberValue(snapshot?.latestTrade?.p) ??
    numberValue(snapshot?.dailyBar?.c) ??
    numberValue(snapshot?.latestQuote?.ap) ??
    numberValue(snapshot?.latestQuote?.bp);
  const previousClose = numberValue(snapshot?.prevDailyBar?.c);
  const dayChangePercent =
    price !== undefined && previousClose !== undefined && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : undefined;

  return {
    symbol: stringValue(asset.symbol) ?? "UNKNOWN",
    name: stringValue(asset.name),
    exchange: stringValue(asset.exchange),
    assetClass: stringValue(asset.asset_class),
    tradable: boolValue(asset.tradable) ?? false,
    marginable: boolValue(asset.marginable),
    shortable: boolValue(asset.shortable),
    easyToBorrow: boolValue(asset.easy_to_borrow),
    fractionable: boolValue(asset.fractionable),
    price,
    previousClose,
    dayChangePercent,
    dailyVolume: numberValue(snapshot?.dailyBar?.v),
    updatedAt:
      stringValue(snapshot?.latestTrade?.t) ??
      stringValue(snapshot?.latestQuote?.t) ??
      stringValue(snapshot?.dailyBar?.t),
    source: "alpaca",
  };
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function readSnapshotMap(
  response: Record<string, AlpacaStockSnapshot> | { snapshots?: Record<string, AlpacaStockSnapshot> },
): Record<string, AlpacaStockSnapshot> {
  const wrapped = response as { snapshots?: Record<string, AlpacaStockSnapshot> };
  return wrapped.snapshots ?? (response as Record<string, AlpacaStockSnapshot>);
}

function toBrokerOrder(
  order: AlpacaOrder,
  fallback: Partial<BrokerOrder> = {},
): BrokerOrder {
  const alpacaOrderId = stringValue(order.id);
  const createdAt = stringValue(order.created_at) ?? fallback.createdAt ?? new Date().toISOString();
  const updatedAt =
    stringValue(order.updated_at) ??
    fallback.updatedAt ??
    createdAt;
  const clientOrderId =
    stringValue(order.client_order_id) ??
    fallback.clientOrderId ??
    alpacaOrderId ??
    randomUUID();

  return {
    id: fallback.id ?? alpacaOrderId ?? clientOrderId,
    createdAt,
    updatedAt,
    provider: "alpaca",
    environment: "paper",
    alpacaOrderId,
    clientOrderId,
    status: normalizeOrderStatus(order.status),
    symbol: stringValue(order.symbol) ?? fallback.symbol ?? "UNKNOWN",
    side: normalizeSide(order.side) ?? fallback.side ?? "buy",
    orderType: normalizeOrderType(order.type) ?? fallback.orderType ?? "market",
    timeInForce: normalizeTimeInForce(order.time_in_force) ?? fallback.timeInForce ?? "day",
    qty: numberValue(order.qty) ?? fallback.qty,
    notional: numberValue(order.notional) ?? fallback.notional,
    limitPrice: numberValue(order.limit_price) ?? fallback.limitPrice,
    submittedAt: stringValue(order.submitted_at) ?? fallback.submittedAt ?? createdAt,
    raw: order,
    metadata: fallback.metadata,
  };
}

function randomUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
