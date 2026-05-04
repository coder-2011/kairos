import { describe, expect, it } from "vitest";
import {
  NASDAQ_LISTED_URL,
  OTHER_LISTED_URL,
  YAHOO_QUOTE_URL,
  createMarketSymbolDirectoryProvider,
} from "./market-symbols.js";

describe("market symbol directory provider", () => {
  it("assembles NASDAQ Trader symbols and Yahoo prices", async () => {
    const provider = createMarketSymbolDirectoryProvider({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === NASDAQ_LISTED_URL) {
          return textResponse([
            "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
            "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
            "TEST|Test Issue Inc. - Common Stock|Q|Y|N|100|N|N",
            "File Creation Time: 0503202600:00|||||||",
          ].join("\n"));
        }
        if (url === OTHER_LISTED_URL) {
          return textResponse([
            "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
            "SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY",
          ].join("\n"));
        }
        if (url.startsWith(YAHOO_QUOTE_URL)) {
          return jsonResponse({
            quoteResponse: {
              result: [
                {
                  symbol: "AAPL",
                  regularMarketPrice: 213.32,
                  regularMarketPreviousClose: 210,
                  regularMarketChangePercent: 1.58,
                  regularMarketVolume: 1000,
                  regularMarketTime: 1_710_000_000,
                  currency: "USD",
                  quoteType: "EQUITY",
                  fullExchangeName: "NasdaqGS",
                },
              ],
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const symbols = await provider.listMarketSymbols({ query: "AAPL", limit: 10 });

    expect(symbols).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        name: "Apple Inc. - Common Stock",
        exchange: "NASDAQ",
        price: 213.32,
        previousClose: 210,
        source: "yahoo",
      }),
    ]);
  });

  it("prioritizes exact symbol tokens in multi-word symbol searches", async () => {
    const provider = createMarketSymbolDirectoryProvider({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === NASDAQ_LISTED_URL) {
          return textResponse([
            "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
            "GSPY|Gotham Enhanced 500 ETF|Q|N|N|100|Y|N",
            "YSPY|GraniteShares YieldBOOST SPY ETF|Q|N|N|100|Y|N",
            "File Creation Time: 0503202600:00|||||||",
          ].join("\n"));
        }
        if (url === OTHER_LISTED_URL) {
          return textResponse([
            "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
            "SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY",
          ].join("\n"));
        }
        if (url.startsWith(YAHOO_QUOTE_URL)) {
          return jsonResponse({ quoteResponse: { result: [] } });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const symbols = await provider.listMarketSymbols({ query: "SPY ETF", limit: 3 });

    expect(symbols[0]?.symbol).toBe("SPY");
    expect(symbols.map((symbol) => symbol.symbol)).toEqual(
      expect.arrayContaining(["SPY", "YSPY", "GSPY"]),
    );
  });
});

function textResponse(text: string): Response {
  return new Response(text, {
    headers: { "content-type": "text/plain" },
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
