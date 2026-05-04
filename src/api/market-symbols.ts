export const NASDAQ_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
export const OTHER_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";
export const YAHOO_QUOTE_URL =
  "https://query1.finance.yahoo.com/v7/finance/quote";

export type MarketSymbolRecord = {
  symbol: string;
  name?: string;
  exchange?: string;
  assetClass?: string;
  tradable: boolean;
  price?: number;
  previousClose?: number;
  dayChangePercent?: number;
  dailyVolume?: number;
  updatedAt?: string;
  currency?: string;
  quoteType?: string;
  exchangeName?: string;
  isEtf?: boolean;
  source: "nasdaq_trader" | "yahoo";
};

export type MarketSymbolQuery = {
  query?: string;
  limit?: number;
  includeQuotes?: boolean;
};

export type MarketSymbolDirectoryProviderOptions = {
  fetchImpl?: typeof fetch;
  directoryTtlMs?: number;
  quoteTtlMs?: number;
  quoteBatchSize?: number;
};

type DirectoryCache = {
  expiresAt: number;
  records: MarketSymbolRecord[];
};

type QuoteCacheEntry = {
  expiresAt: number;
  quote: Partial<MarketSymbolRecord>;
};

const defaultDirectoryTtlMs = 24 * 60 * 60 * 1000;
const defaultQuoteTtlMs = 5 * 60 * 1000;
const exchangeNames: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  V: "IEX",
  Z: "Cboe BZX",
};

export function createMarketSymbolDirectoryProvider(
  options: MarketSymbolDirectoryProviderOptions = {},
): {
  listMarketSymbols(input?: MarketSymbolQuery): Promise<MarketSymbolRecord[]>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const directoryTtlMs = options.directoryTtlMs ?? defaultDirectoryTtlMs;
  const quoteTtlMs = options.quoteTtlMs ?? defaultQuoteTtlMs;
  const quoteBatchSize = options.quoteBatchSize ?? 100;
  let directoryCache: DirectoryCache | undefined;
  const quoteCache = new Map<string, QuoteCacheEntry>();

  async function loadDirectory(): Promise<MarketSymbolRecord[]> {
    const now = Date.now();
    if (directoryCache && directoryCache.expiresAt > now) {
      return directoryCache.records;
    }

    const [nasdaqText, otherText] = await Promise.all([
      fetchText(fetchImpl, NASDAQ_LISTED_URL),
      fetchText(fetchImpl, OTHER_LISTED_URL),
    ]);
    const records = mergeDirectoryRecords([
      ...parseNasdaqListed(nasdaqText),
      ...parseOtherListed(otherText),
    ]);
    directoryCache = {
      expiresAt: now + directoryTtlMs,
      records,
    };
    return records;
  }

  async function listMarketSymbols(
    input: MarketSymbolQuery = {},
  ): Promise<MarketSymbolRecord[]> {
    const query = input.query?.trim().toUpperCase();
    const queryTokens = marketSymbolSearchTokens(query);
    const limit =
      input.limit === undefined
        ? undefined
        : Math.max(1, Math.min(input.limit, 25_000));
    const directory = await loadDirectory();
    const filteredDirectory = directory
      .filter((record) => {
        if (!query) return true;
        return matchesMarketSymbolRecord(record, query, queryTokens);
      })
      .sort((left, right) =>
        relevance(left, query, queryTokens) - relevance(right, query, queryTokens),
      );
    const filtered = limit === undefined ? filteredDirectory : filteredDirectory.slice(0, limit);
    const quotes = input.includeQuotes === false
      ? new Map<string, Partial<MarketSymbolRecord>>()
      : await fetchYahooQuotes(
          fetchImpl,
          filtered.map((record) => record.symbol),
          quoteCache,
          quoteTtlMs,
          quoteBatchSize,
        );

    return filtered.map((record) => ({
      ...record,
      ...quotes.get(record.symbol),
      source: quotes.has(record.symbol) ? "yahoo" : record.source,
    }));
  }

  return { listMarketSymbols };
}

function matchesMarketSymbolRecord(
  record: MarketSymbolRecord,
  query: string,
  queryTokens: string[],
): boolean {
  const text = [
    record.symbol,
    record.name,
    record.exchange,
    record.assetClass,
    record.exchangeName,
    record.quoteType,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return text.includes(query) || queryTokens.some((token) => text.includes(token));
}

function relevance(
  record: MarketSymbolRecord,
  query: string | undefined,
  queryTokens: string[] = [],
): number {
  if (!query) return 0;
  if (record.symbol === query) return 0;
  if (queryTokens.some((token) => record.symbol === token)) return 1;
  if (record.symbol.startsWith(query)) return 2;
  if (record.symbol.includes(query)) return 3;
  if (queryTokens.some((token) => record.symbol.startsWith(token))) return 4;
  if (queryTokens.some((token) => record.symbol.includes(token))) return 5;
  if (record.name?.toUpperCase().startsWith(query)) return 6;
  if (record.name?.toUpperCase().includes(query)) return 7;
  if (queryTokens.some((token) => record.name?.toUpperCase().includes(token))) return 8;
  return 9;
}

function marketSymbolSearchTokens(query: string | undefined): string[] {
  if (!query) return [];
  return query
    .split(/[^A-Z0-9.-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !marketSymbolSearchStopWords.has(token));
}

const marketSymbolSearchStopWords = new Set([
  "ETF",
  "FUND",
  "INC",
  "STOCK",
  "THE",
]);

function parseNasdaqListed(text: string): MarketSymbolRecord[] {
  return parsePipeRows(text)
    .filter((row) => row["Test Issue"] === "N")
    .map((row) => ({
      symbol: normalizeSymbol(row.Symbol),
      name: readString(row["Security Name"]),
      exchange: "NASDAQ",
      assetClass: "us_equity",
      tradable: true,
      isEtf: row.ETF === "Y",
      source: "nasdaq_trader" as const,
    }))
    .filter((record) => Boolean(record.symbol));
}

function parseOtherListed(text: string): MarketSymbolRecord[] {
  return parsePipeRows(text)
    .filter((row) => row["Test Issue"] === "N")
    .map((row) => ({
      symbol: normalizeSymbol(row["ACT Symbol"]),
      name: readString(row["Security Name"]),
      exchange:
        exchangeNames[row.Exchange ?? ""] ??
        readString(row.Exchange),
      assetClass: "us_equity",
      tradable: true,
      isEtf: row.ETF === "Y",
      source: "nasdaq_trader" as const,
    }))
    .filter((record) => Boolean(record.symbol));
}

function parsePipeRows(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("File Creation Time"));
  const [headerLine, ...dataLines] = lines;
  if (!headerLine) return [];
  const headers = headerLine.split("|");

  return dataLines.map((line) => {
    const values = line.split("|");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

function mergeDirectoryRecords(records: MarketSymbolRecord[]): MarketSymbolRecord[] {
  const merged = new Map<string, MarketSymbolRecord>();
  for (const record of records) {
    if (!record.symbol || merged.has(record.symbol)) continue;
    merged.set(record.symbol, record);
  }
  return [...merged.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

async function fetchYahooQuotes(
  fetchImpl: typeof fetch,
  symbols: string[],
  quoteCache: Map<string, QuoteCacheEntry>,
  quoteTtlMs: number,
  batchSize: number,
): Promise<Map<string, Partial<MarketSymbolRecord>>> {
  const now = Date.now();
  const quotes = new Map<string, Partial<MarketSymbolRecord>>();
  const missing: string[] = [];

  for (const symbol of symbols) {
    const cached = quoteCache.get(symbol);
    if (cached && cached.expiresAt > now) {
      quotes.set(symbol, cached.quote);
    } else {
      missing.push(symbol);
    }
  }

  for (const batch of chunks(missing, batchSize)) {
    const yahooToSymbol = new Map(batch.map((symbol) => [toYahooSymbol(symbol), symbol]));
    const url = new URL(YAHOO_QUOTE_URL);
    url.searchParams.set("symbols", [...yahooToSymbol.keys()].join(","));
    const response = await fetchImpl(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "Kairos local ticker directory",
      },
    });
    if (!response.ok) continue;

    const body = await response.json() as {
      quoteResponse?: { result?: Record<string, unknown>[] };
    };
    for (const item of body.quoteResponse?.result ?? []) {
      const yahooSymbol = readString(item.symbol);
      if (!yahooSymbol) continue;
      const symbol = yahooToSymbol.get(yahooSymbol);
      if (!symbol) continue;
      const quote = toQuoteRecord(item);
      quotes.set(symbol, quote);
      quoteCache.set(symbol, {
        expiresAt: now + quoteTtlMs,
        quote,
      });
    }
  }

  return quotes;
}

function toQuoteRecord(item: Record<string, unknown>): Partial<MarketSymbolRecord> {
  const marketTime = numberValue(item.regularMarketTime);
  return {
    price: numberValue(item.regularMarketPrice),
    previousClose: numberValue(item.regularMarketPreviousClose),
    dayChangePercent: numberValue(item.regularMarketChangePercent),
    dailyVolume: numberValue(item.regularMarketVolume),
    updatedAt: marketTime ? new Date(marketTime * 1000).toISOString() : undefined,
    currency: readString(item.currency),
    quoteType: readString(item.quoteType),
    exchangeName: readString(item.fullExchangeName),
  };
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function normalizeSymbol(value: string | undefined): string {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? "";
}

function toYahooSymbol(symbol: string): string {
  return symbol.replaceAll(".", "-");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
