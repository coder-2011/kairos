import type { HeartbeatSeedDataProviders } from "../agents/heartbeat/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

type FinnhubCallback<T> = (error: unknown, data: T, response: unknown) => void;

type FinnhubPackageClient = {
  stockCandles: (
    symbol: string,
    resolution: string,
    from: number,
    to: number,
    callback: FinnhubCallback<FinnhubCandleResponse>,
  ) => void;
  companyNews: (
    symbol: string,
    from: string,
    to: string,
    callback: FinnhubCallback<FinnhubNewsItem[]>,
  ) => void;
  quote: (symbol: string, callback: FinnhubCallback<FinnhubQuote>) => void;
  aggregateIndicator?: (
    symbol: string,
    resolution: string,
    callback: FinnhubCallback<unknown>,
  ) => void;
  companyBasicFinancials?: (
    symbol: string,
    metric: string,
    callback: FinnhubCallback<unknown>,
  ) => void;
  companyEarnings?: (
    symbol: string,
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  companyEpsEstimates?: (
    symbol: string,
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  companyPeers?: (symbol: string, callback: FinnhubCallback<unknown>) => void;
  companyProfile2?: (
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  earningsCalendar?: (
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  filings?: (
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  financialsReported?: (
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  insiderTransactions?: (
    symbol: string,
    callback: FinnhubCallback<unknown>,
  ) => void;
  newsSentiment?: (symbol: string, callback: FinnhubCallback<unknown>) => void;
  ownership?: (
    symbol: string,
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  pressReleases?: (
    symbol: string,
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
  recommendationTrends?: (
    symbol: string,
    callback: FinnhubCallback<unknown>,
  ) => void;
  socialSentiment?: (symbol: string, callback: FinnhubCallback<unknown>) => void;
  supplyChainRelationships?: (
    symbol: string,
    callback: FinnhubCallback<unknown>,
  ) => void;
  upgradeDowngrade?: (
    opts: Record<string, unknown>,
    callback: FinnhubCallback<unknown>,
  ) => void;
};

export type FinnhubConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  packageClient?: FinnhubPackageClient;
};

export type FinnhubQuote = {
  c: number;
  d?: number;
  dp?: number;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  t?: number;
};

export type FinnhubNewsItem = {
  category?: string;
  datetime: number;
  headline: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary: string;
  url?: string;
};

export type FinnhubCandleResponse = {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  s: "ok" | "no_data";
  t?: number[];
  v?: number[];
};

export class FinnhubApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly packageClient?: FinnhubPackageClient;

  constructor(config: FinnhubConfig = {}) {
    const { apiKey, baseUrl, fetchImpl, packageClient } = config;
    this.apiKey = apiKey ?? process.env.FINNHUB_API_KEY ?? "";
    this.baseUrl = baseUrl ?? "https://finnhub.io/api/v1";
    this.fetchImpl = fetchImpl ?? fetch;
    this.packageClient = packageClient;

    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY is required.");
    }
  }

  quote(symbol: string): Promise<FinnhubQuote> {
    if (this.packageClient) {
      return callbackMethod((callback) => this.packageClient!.quote(symbol, callback));
    }

    return this.get("/quote", { symbol });
  }

  companyNews(input: {
    symbol: string;
    from: string;
    to: string;
  }): Promise<FinnhubNewsItem[]> {
    if (this.packageClient) {
      return callbackMethod((callback) =>
        this.packageClient!.companyNews(input.symbol, input.from, input.to, callback),
      );
    }

    return this.get("/company-news", input);
  }

  stockCandles(input: {
    symbol: string;
    resolution: string;
    from: number;
    to: number;
  }): Promise<FinnhubCandleResponse> {
    if (this.packageClient) {
      return callbackMethod((callback) =>
        this.packageClient!.stockCandles(
          input.symbol,
          input.resolution,
          input.from,
          input.to,
          callback,
        ),
      );
    }

    return this.get("/stock/candle", {
      symbol: input.symbol,
      resolution: input.resolution,
      from: String(input.from),
      to: String(input.to),
    });
  }

  aggregateIndicator(symbol: string, resolution = "D"): Promise<unknown> {
    return this.packageOrGet(
      "aggregateIndicator",
      (client, callback) => client.aggregateIndicator?.(symbol, resolution, callback),
      "/scan/technical-indicator",
      { symbol, resolution },
    );
  }

  basicFinancials(symbol: string, metric = "all"): Promise<unknown> {
    return this.packageOrGet(
      "companyBasicFinancials",
      (client, callback) => client.companyBasicFinancials?.(symbol, metric, callback),
      "/stock/metric",
      { symbol, metric },
    );
  }

  companyEarnings(symbol: string, limit = 4): Promise<unknown> {
    return this.packageOrGet(
      "companyEarnings",
      (client, callback) => client.companyEarnings?.(symbol, { limit }, callback),
      "/stock/earnings",
      { symbol, limit: String(limit) },
    );
  }

  companyEpsEstimates(symbol: string, freq = "quarterly"): Promise<unknown> {
    return this.packageOrGet(
      "companyEpsEstimates",
      (client, callback) => client.companyEpsEstimates?.(symbol, { freq }, callback),
      "/stock/eps-estimate",
      { symbol, freq },
    );
  }

  companyPeers(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "companyPeers",
      (client, callback) => client.companyPeers?.(symbol, callback),
      "/stock/peers",
      { symbol },
    );
  }

  companyProfile2(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "companyProfile2",
      (client, callback) => client.companyProfile2?.({ symbol }, callback),
      "/stock/profile2",
      { symbol },
    );
  }

  earningsCalendar(input: {
    symbol?: string;
    from: string;
    to: string;
  }): Promise<unknown> {
    return this.packageOrGet(
      "earningsCalendar",
      (client, callback) => client.earningsCalendar?.(input, callback),
      "/calendar/earnings",
      input,
    );
  }

  filings(input: { symbol: string; from?: string; to?: string }): Promise<unknown> {
    return this.packageOrGet(
      "filings",
      (client, callback) => client.filings?.(input, callback),
      "/stock/filings",
      input,
    );
  }

  financialsReported(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "financialsReported",
      (client, callback) => client.financialsReported?.({ symbol }, callback),
      "/stock/financials-reported",
      { symbol },
    );
  }

  insiderTransactions(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "insiderTransactions",
      (client, callback) => client.insiderTransactions?.(symbol, callback),
      "/stock/insider-transactions",
      { symbol },
    );
  }

  newsSentiment(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "newsSentiment",
      (client, callback) => client.newsSentiment?.(symbol, callback),
      "/news-sentiment",
      { symbol },
    );
  }

  ownership(symbol: string, limit = 20): Promise<unknown> {
    return this.packageOrGet(
      "ownership",
      (client, callback) => client.ownership?.(symbol, { limit }, callback),
      "/stock/ownership",
      { symbol, limit: String(limit) },
    );
  }

  pressReleases(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "pressReleases",
      (client, callback) => client.pressReleases?.(symbol, {}, callback),
      "/press-releases",
      { symbol },
    );
  }

  recommendationTrends(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "recommendationTrends",
      (client, callback) => client.recommendationTrends?.(symbol, callback),
      "/stock/recommendation",
      { symbol },
    );
  }

  socialSentiment(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "socialSentiment",
      (client, callback) => client.socialSentiment?.(symbol, callback),
      "/stock/social-sentiment",
      { symbol },
    );
  }

  supplyChainRelationships(symbol: string): Promise<unknown> {
    return this.packageOrGet(
      "supplyChainRelationships",
      (client, callback) => client.supplyChainRelationships?.(symbol, callback),
      "/stock/supply-chain",
      { symbol },
    );
  }

  upgradeDowngrade(input: {
    symbol: string;
    from?: string;
    to?: string;
  }): Promise<unknown> {
    return this.packageOrGet(
      "upgradeDowngrade",
      (client, callback) => client.upgradeDowngrade?.(input, callback),
      "/stock/upgrade-downgrade",
      input,
    );
  }

  private async get<T>(
    path: string,
    params: Record<string, string | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("token", this.apiKey);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    });

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Finnhub ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  private packageOrGet<T>(
    methodName: string,
    packageCall: (
      client: FinnhubPackageClient,
      callback: FinnhubCallback<T>,
    ) => void | undefined,
    path: string,
    params: Record<string, string | undefined>,
  ): Promise<T> {
    if (!this.packageClient) {
      return this.get(path, params);
    }

    return callbackMethod((callback) => {
      const result = packageCall(this.packageClient!, callback);
      if (result === undefined) {
        throw new Error(`Finnhub package client does not implement ${methodName}.`);
      }
    });
  }
}

export function createFinnhubHeartbeatSeedProviders(
  finnhub: FinnhubApi,
): HeartbeatSeedDataProviders {
  return {
    getCurrentPrice: async ({ branch }) => {
      return mapAssets(branch.assets, (symbol) => finnhub.quote(symbol));
    },
    getRecentVolume: async ({ branch, seedWindowDays, timestamp }) => {
      return mapAssets(branch.assets, async (symbol) => {
        const candles = await getDailyCandles(finnhub, symbol, seedWindowDays, timestamp);
        const volumes = candles.v ?? [];
        const latest = volumes.at(-1) ?? null;
        const average =
          volumes.length > 0
            ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length
            : null;

        return {
          latest,
          average,
          relativeVolume: latest != null && average ? latest / average : null,
          windowDays: seedWindowDays,
        };
      });
    },
    getTickerMovement: async ({ branch, seedWindowDays, timestamp }) => {
      return mapAssets(branch.assets, async (symbol) => {
        const [quote, candles] = await Promise.all([
          finnhub.quote(symbol),
          getDailyCandles(finnhub, symbol, seedWindowDays, timestamp),
        ]);
        const closes = candles.c ?? [];
        const firstClose = closes[0] ?? null;
        const latestClose = closes.at(-1) ?? quote.c ?? null;

        return {
          current: quote.c,
          change: quote.d ?? null,
          percentChange: quote.dp ?? null,
          previousClose: quote.pc ?? null,
          windowDays: seedWindowDays,
          windowPercentChange:
            firstClose && latestClose ? ((latestClose - firstClose) / firstClose) * 100 : null,
        };
      });
    },
    getNewsHeadlinesAndSummaries: async ({ branch, seedWindowDays, timestamp }) => {
      const { from, to } = dateRange(seedWindowDays, timestamp);
      const nestedNews = await Promise.all(
        branch.assets.map((symbol) =>
          finnhub.companyNews({ symbol, from, to }).then((items) =>
            items.map((item) => ({
              title: item.headline,
              summary: item.summary,
              source: item.source,
              publishedAt: new Date(item.datetime * 1000).toISOString(),
              url: item.url,
            })),
          ),
        ),
      );

      return nestedNews.flat();
    },
    getOptionalData: ({ branch, sourceKey, seedWindowDays, timestamp }) => {
      return mapAssets(branch.assets, (symbol) =>
        getOptionalFinnhubSource(finnhub, sourceKey, symbol, seedWindowDays, timestamp),
      );
    },
  };
}

function getOptionalFinnhubSource(
  finnhub: FinnhubApi,
  sourceKey: string,
  symbol: string,
  seedWindowDays: number,
  timestamp: string,
): Promise<unknown> {
  const range = dateRange(seedWindowDays, timestamp);

  switch (sourceKey) {
    case "aggregateIndicator":
      return finnhub.aggregateIndicator(symbol);
    case "analystRecommendations":
    case "recommendationTrends":
      return finnhub.recommendationTrends(symbol);
    case "analystUpdates":
    case "upgradeDowngrade":
      return finnhub.upgradeDowngrade({ symbol, ...range });
    case "basicFinancials":
      return finnhub.basicFinancials(symbol);
    case "companyEarnings":
    case "earningsSurprises":
      return finnhub.companyEarnings(symbol);
    case "companyProfile":
    case "companyProfile2":
      return finnhub.companyProfile2(symbol);
    case "earnings":
    case "earningsCalendar":
      return finnhub.earningsCalendar({ symbol, ...range });
    case "epsEstimates":
      return finnhub.companyEpsEstimates(symbol);
    case "financialsReported":
      return finnhub.financialsReported(symbol);
    case "insiderActivity":
    case "insiderTransactions":
      return finnhub.insiderTransactions(symbol);
    case "newsSentiment":
      return finnhub.newsSentiment(symbol);
    case "ownership":
      return finnhub.ownership(symbol);
    case "peers":
      return finnhub.companyPeers(symbol);
    case "pressReleases":
      return finnhub.pressReleases(symbol);
    case "secFilings":
      return finnhub.filings({ symbol, ...range });
    case "socialSentiment":
      return finnhub.socialSentiment(symbol);
    case "supplyChain":
      return finnhub.supplyChainRelationships(symbol);
    default:
      return Promise.resolve(null);
  }
}

async function getDailyCandles(
  finnhub: FinnhubApi,
  symbol: string,
  days: number,
  timestamp: string,
): Promise<FinnhubCandleResponse> {
  const to = Math.floor(Date.parse(timestamp) / 1000);
  const from = to - days * DAY_SECONDS;
  const candles = await finnhub.stockCandles({ symbol, resolution: "D", from, to });
  return candles.s === "ok" ? candles : { s: "no_data" };
}

async function mapAssets<T>(
  assets: string[],
  mapper: (symbol: string) => Promise<T>,
): Promise<Record<string, T>> {
  return Object.fromEntries(
    await Promise.all(assets.map(async (symbol) => [symbol, await mapper(symbol)])),
  );
}

function formatDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toISOString().slice(0, 10);
}

function dateRange(days: number, timestamp: string): { from: string; to: string } {
  return {
    from: formatDate(new Date(Date.parse(timestamp) - days * DAY_MS)),
    to: formatDate(timestamp),
  };
}

function callbackMethod<T>(
  invoke: (callback: FinnhubCallback<T>) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });
}
