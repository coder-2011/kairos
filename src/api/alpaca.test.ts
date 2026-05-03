import { describe, expect, it } from "vitest";

import { AlpacaTradingClient } from "./alpaca.js";

describe("AlpacaTradingClient", () => {
  it("uses paper REST auth headers and normalizes portfolio snapshots", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      if (request.url.endsWith("/v2/account")) {
        return jsonResponse({
          status: "ACTIVE",
          cash: "99000",
          buying_power: "99000",
          portfolio_value: "100500",
          equity: "100500",
          daytrade_count: 0,
        });
      }
      if (request.url.endsWith("/v2/positions")) {
        return jsonResponse([
          {
            symbol: "PLTR",
            qty: "4",
            market_value: "100",
            current_price: "25",
          },
        ]);
      }
      throw new Error(`Unexpected URL ${request.url}`);
    };

    const client = new AlpacaTradingClient({
      apiKey: "paper-key",
      secretKey: "paper-secret",
      baseUrl: "http://alpaca.test",
      fetchImpl,
      retryAttempts: 1,
    });

    const snapshot = await client.getPortfolioSnapshot();

    expect(snapshot).toMatchObject({
      provider: "alpaca",
      environment: "paper",
      account: {
        status: "ACTIVE",
        buyingPower: 99000,
        portfolioValue: 100500,
      },
      positions: [
        {
          symbol: "PLTR",
          qty: 4,
          currentPrice: 25,
        },
      ],
    });
    expect(requests[0].headers.get("APCA-API-KEY-ID")).toBe("paper-key");
    expect(requests[0].headers.get("APCA-API-SECRET-KEY")).toBe("paper-secret");
  });

  it("submits paper orders with Alpaca order field names", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      submittedBody = await request.json();
      return jsonResponse({
        id: "alpaca_order_1",
        client_order_id: "kairos_trade_1",
        status: "accepted",
        symbol: "PLTR",
        side: "buy",
        type: "market",
        time_in_force: "day",
        notional: "500",
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      });
    };

    const client = new AlpacaTradingClient({
      apiKey: "paper-key",
      secretKey: "paper-secret",
      baseUrl: "http://alpaca.test",
      fetchImpl,
      retryAttempts: 1,
    });

    const order = await client.submitPaperOrder({
      symbol: "PLTR",
      side: "buy",
      type: "market",
      timeInForce: "day",
      notional: 500,
      clientOrderId: "kairos_trade_1",
    });

    expect(submittedBody).toMatchObject({
      symbol: "PLTR",
      side: "buy",
      type: "market",
      time_in_force: "day",
      notional: "500",
      client_order_id: "kairos_trade_1",
    });
    expect(order).toMatchObject({
      alpacaOrderId: "alpaca_order_1",
      clientOrderId: "kairos_trade_1",
      status: "accepted",
      symbol: "PLTR",
      notional: 500,
    });
  });

  it("loads active symbols and enriches them with market snapshots", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      if (request.url.endsWith("/v2/assets?status=active&asset_class=us_equity")) {
        return jsonResponse([
          {
            symbol: "PLTR",
            name: "Palantir Technologies Inc.",
            exchange: "NASDAQ",
            tradable: true,
            marginable: true,
            shortable: true,
            fractionable: true,
            status: "active",
            asset_class: "us_equity",
          },
          {
            symbol: "MSFT",
            name: "Microsoft Corporation",
            exchange: "NASDAQ",
            tradable: true,
            status: "active",
            asset_class: "us_equity",
          },
        ]);
      }

      if (request.url.startsWith("https://data.alpaca.test/v2/stocks/snapshots")) {
        return jsonResponse({
          PLTR: {
            latestTrade: { p: 25.5, t: "2026-05-03T16:00:00Z" },
            dailyBar: { v: 1000 },
            prevDailyBar: { c: 25 },
          },
        });
      }

      throw new Error(`Unexpected URL ${request.url}`);
    };

    const client = new AlpacaTradingClient({
      apiKey: "paper-key",
      secretKey: "paper-secret",
      baseUrl: "http://alpaca.test",
      marketDataBaseUrl: "https://data.alpaca.test",
      fetchImpl,
      retryAttempts: 1,
    });

    const symbols = await client.listMarketSymbols({ query: "pal", limit: 10 });

    expect(symbols).toEqual([
      {
        symbol: "PLTR",
        name: "Palantir Technologies Inc.",
        exchange: "NASDAQ",
        assetClass: "us_equity",
        tradable: true,
        marginable: true,
        shortable: true,
        easyToBorrow: undefined,
        fractionable: true,
        price: 25.5,
        previousClose: 25,
        dayChangePercent: 2,
        dailyVolume: 1000,
        updatedAt: "2026-05-03T16:00:00Z",
        source: "alpaca",
      },
    ]);
    expect(requests[1].url).toContain("symbols=PLTR");
    expect(requests[1].url).toContain("feed=iex");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
