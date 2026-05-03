export type AlpacaClientOptions = {
  apiKey?: string;
  secretKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type AlpacaOrderRequest = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: "day" | "gtc";
  client_order_id: string;
  notional?: string;
  qty?: string;
  limit_price?: string;
};

const defaultPaperBaseUrl = "https://paper-api.alpaca.markets";

export class AlpacaTradingClient {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AlpacaClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ALPACA_API_KEY ?? "";
    this.secretKey = options.secretKey ?? process.env.ALPACA_SECRET_KEY ?? "";
    this.baseUrl = (options.baseUrl ?? process.env.ALPACA_BASE_URL ?? defaultPaperBaseUrl).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  get mode(): "paper" {
    return "paper";
  }

  async getAccount(): Promise<Record<string, unknown>> {
    return this.request("/v2/account");
  }

  async getClock(): Promise<Record<string, unknown>> {
    return this.request("/v2/clock");
  }

  async getAsset(symbol: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/assets/${encodeURIComponent(symbol)}`);
  }

  async listPositions(): Promise<Array<Record<string, unknown>>> {
    return this.request("/v2/positions");
  }

  async listOrders(input: { status?: "open" | "closed" | "all"; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams();
    params.set("status", input.status ?? "all");
    params.set("limit", String(input.limit ?? 50));
    return this.request(`/v2/orders?${params.toString()}`);
  }

  async submitOrder(order: AlpacaOrderRequest): Promise<Record<string, unknown>> {
    return this.request("/v2/orders", {
      method: "POST",
      body: JSON.stringify(order),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.configured) {
      throw new Error("Missing Alpaca credentials: ALPACA_API_KEY and ALPACA_SECRET_KEY are required.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.secretKey,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "message" in body
          ? String(body.message)
          : `Alpaca request failed with status ${response.status}`;
      throw new Error(message);
    }

    return body as T;
  }
}

export function createAlpacaTradingClient(options: AlpacaClientOptions = {}): AlpacaTradingClient {
  return new AlpacaTradingClient(options);
}
