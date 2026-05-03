export const FINNHUB_REST_ENDPOINT_CATALOG = [
  "symbol_lookup | GET | /search?q=apple&exchange=US | Symbol Lookup",
  "stock_symbols | GET | /stock/symbol?exchange=US | Stock Symbol",
  "market_status | GET | /stock/market-status?exchange=US | Market Status",
  "market_holiday | GET | /stock/market-holiday?exchange=US | Market Holiday",
  "company_profile | GET | /stock/profile?symbol=AAPL | Company Profile Premium",
  "company_profile2 | GET | /stock/profile2?symbol=AAPL | Company Profile 2",
  "company_executive | GET | /stock/executive?symbol=AAPL | Company Executive Premium",
  "general_news | GET | /news?category=general | Market News",
  "company_news | GET | /company-news?symbol=AAPL&from=2025-05-15&to=2025-06-20 | Company News",
  "press_releases | GET | /press-releases?symbol=AAPL | Major Press Releases Premium",
  "news_sentiment | GET | /news-sentiment?symbol=V | News Sentiment Premium",
  "company_peers | GET | /stock/peers?symbol=AAPL | Peers",
  "company_basic_financials | GET | /stock/metric?symbol=AAPL&metric=all | Basic Financials",
  "ownership | GET | /stock/ownership?symbol=AAPL&limit=20 | Ownership Premium",
  "fund_ownership | GET | /stock/fund-ownership?symbol=TSLA&limit=20 | Fund Ownership Premium",
  "institutional_profile | GET | /institutional/profile | Institutional Profile Premium",
  "institutional_portfolio | GET | /institutional/portfolio?cik=1000097&from=2022-05-01&to=2022-09-01 | Institutional Portfolio Premium",
  "institutional_ownership | GET | /institutional/ownership?symbol=TSLA&from=2022-09-01&to=2022-10-30 | Institutional Ownership Premium",
  "stock_insider_transactions | GET | /stock/insider-transactions?symbol=TSLA&limit=20 | Insider Transactions",
  "stock_insider_sentiment | GET | /stock/insider-sentiment?symbol=TSLA&from=2015-01-01&to=2022-03-01 | Insider Sentiment",
  "financials | GET | /stock/financials?symbol=AAPL&statement=bs&freq=annual | Financial Statements Premium",
  "financials_reported | GET | /stock/financials-reported?symbol=AAPL | Financials As Reported",
  "stock_revenue_breakdown | GET | /stock/revenue-breakdown?symbol=AAPL | Revenue Breakdown Premium",
  "filings | GET | /stock/filings?symbol=AAPL | SEC Filings",
  "sec_sentiment_analysis | GET | /stock/filings-sentiment?accessNumber=0000320193-20-000052 | SEC Sentiment Analysis Premium",
  "sec_similarity_index | GET | /stock/similarity-index?symbol=AAPL&freq=annual | Similarity Index Premium",
  "ipo_calendar | GET | /calendar/ipo?from=2020-01-01&to=2020-04-30 | IPO Calendar",
  "stock_dividends | GET | /stock/dividend?symbol=AAPL&from=2022-02-01&to=2023-02-01 | Dividends Premium",
  "sector_metric | GET | /sector/metrics?region=NA | Sector Metrics Premium",
  "price_metrics | GET | /stock/price-metric?symbol=AAPL | Price Metrics Premium",
  "symbol_change | GET | /ca/symbol-change?from=2022-09-01&to=2022-10-30 | Symbol Change Premium",
  "isin_change | GET | /ca/isin-change?from=2022-09-01&to=2022-10-30 | ISIN Change Premium",
  "historical_market_cap | GET | /stock/historical-market-cap?symbol=AAPL&from=2022-01-01&to=2024-05-06 | Historical Market Cap Premium",
  "historical_employee_count | GET | /stock/historical-employee-count?symbol=AAPL&from=2022-01-01&to=2024-05-06 | Historical Employee Count Premium",
  "recommendation_trends | GET | /stock/recommendation?symbol=AAPL | Recommendation Trends",
  "price_target | GET | /stock/price-target?symbol=NFLX | Price Target Premium",
  "upgrade_downgrade | GET | /stock/upgrade-downgrade?symbol=AAPL | Stock Upgrade/Downgrade Premium",
  "company_revenue_estimates | GET | /stock/revenue-estimate?symbol=AAPL | Revenue Estimates Premium",
  "company_eps_estimates | GET | /stock/eps-estimate?symbol=AAPL | Earnings Estimates Premium",
  "company_ebitda_estimates | GET | /stock/ebitda-estimate?symbol=AAPL | EBITDA Estimates Premium",
  "company_ebit_estimates | GET | /stock/ebit-estimate?symbol=AAPL | EBIT Estimates Premium",
  "company_net_income_estimates | GET | /stock/net-income-estimate?symbol=AAPL | Net Income Estimates Premium",
  "company_pretax_income_estimates | GET | /stock/pretax-income-estimate?symbol=AAPL | Pretax Income Estimates Premium",
  "company_gross_income_estimates | GET | /stock/gross-income-estimate?symbol=AAPL | Gross Income Estimates Premium",
  "company_dps_estimates | GET | /stock/dps-estimate?symbol=AAPL | DPS Estimates Premium",
  "company_earnings | GET | /stock/earnings?symbol=AAPL | Earnings Surprises",
  "earnings_calendar | GET | /calendar/earnings?from=2025-08-01&to=2025-08-10 | Earnings Calendar",
  "quote | GET | /quote?symbol=AAPL | Quote",
  "stock_candles | GET | /stock/candle?symbol=AAPL&resolution=1&from=1738655051&to=1738741451 | Stock Candles Premium",
  "stock_tick | GET | /stock/tick?symbol=AAPL&date=2026-04-22&limit=500&skip=0&format=json | Tick Data Premium",
  "stock_nbbo | GET | /stock/bbo?symbol=AAPL&date=2025-06-25&limit=500&skip=0&format=json | Historical NBBO Premium",
  "last_bid_ask | GET | /stock/bidask?symbol=AAPL | Last Bid-Ask Premium",
  "stock_splits | GET | /stock/split?symbol=AAPL&from=2015-02-01&to=2021-03-09 | Splits Premium",
  "stock_basic_dividends | GET | /stock/dividend2?symbol=AAPL | Dividends 2 (Basic) Premium",
  "indices_const | GET | /index/constituents?symbol=^GSPC | Indices Constituents Premium",
  "indices_hist_const | GET | /index/historical-constituents?symbol=^GSPC | Indices Historical Constituents Premium",
  "etfs_profile | GET | /etf/profile?symbol=SPY | ETFs Profile Premium",
  "etfs_holdings | GET | /etf/holdings?symbol=SPY | ETFs Holdings Premium",
  "etfs_sector_exp | GET | /etf/sector?symbol=SPY | ETFs Sector Exposure Premium",
  "etfs_country_exp | GET | /etf/country?symbol=SPY | ETFs Country Exposure Premium",
  "etfs_allocation | GET | /etf/allocation?symbol=SPY | ETFs Equity Allocation Premium",
  "mutual_fund_profile | GET | /mutual-fund/profile?symbol=VTSAX | Mutual Funds Profile Premium",
  "mutual_fund_holdings | GET | /mutual-fund/holdings?symbol=VTSAX | Mutual Funds Holdings Premium",
  "mutual_fund_sector_exp | GET | /mutual-fund/sector?symbol=VTSAX | Mutual Funds Sector Exposure Premium",
  "mutual_fund_country_exp | GET | /mutual-fund/country?symbol=FNILX | Mutual Funds Country Exposure Premium",
  "mutual_fund_eet | GET | /mutual-fund/eet?isin=LU2036931686 | Mutual Funds EET Premium",
  "mutual_fund_eet_pai | GET | /mutual-fund/eet-pai?isin=LU2036931686 | Mutual Funds EET PAI Premium",
  "bond_profile | GET | /bond/profile?figi=BBG0152KFHS6 | Bond Profile Premium",
  "bond_price | GET | /bond/price?isin=US912810TD00&from=1590988249&to=1649099548 | Bond price data Premium",
  "bond_tick | GET | /bond/tick?isin=US693475BF18&date=2022-08-19&limit=50&skip=6&format=json&exchange=trace | Bond Tick Data Premium",
  "bond_yield_curve | GET | /bond/yield-curve?code=10y | Bond Yield Curve Premium",
  "forex_exchanges | GET | /forex/exchange | Forex Exchanges",
  "forex_symbols | GET | /forex/symbol?exchange=oanda | Forex Symbol",
  "forex_candles | GET | /forex/candle?symbol=OANDA:EUR_USD&resolution=D&from=1572651390&to=1575243390 | Forex Candles Premium",
  "forex_rates | GET | /forex/rates?base=USD | Forex rates Premium",
  "crypto_exchanges | GET | /crypto/exchange | Crypto Exchanges",
  "crypto_symbols | GET | /crypto/symbol?exchange=binance | Crypto Symbol",
  "crypto_profile | GET | /crypto/profile?symbol=BTC | Crypto Profile Premium",
  "crypto_candles | GET | /crypto/candle?symbol=BINANCE:BTCUSDT&resolution=D&from=1572651390&to=1575243390 | Crypto Candles Premium",
  "pattern_recognition | GET | /scan/pattern?symbol=AAPL&resolution=D | Pattern Recognition Premium",
  "support_resistance | GET | /scan/support-resistance?symbol=IBM&resolution=D | Support/Resistance Premium",
  "aggregate_indicator | GET | /scan/technical-indicator?symbol=AAPL&resolution=D | Aggregate Indicators Premium",
  "technical_indicator | GET | /indicator?symbol=AAPL&resolution=D&from=1583098857&to=1584308457&indicator=sma&timeperiod=3 | Technical Indicators Premium",
  "transcripts_list | GET | /stock/transcripts/list?symbol=AAPL | Earnings Call Transcripts List Premium",
  "transcripts | GET | /stock/transcripts?id=AAPL_162777 | Earnings Call Transcripts Premium",
  "earnings_call_live | GET | /stock/earnings-call-live?from=2024-11-01&to=2024-11-07 | Earnings Call Audio Live Premium",
  "stock_presentation | GET | /stock/presentation?symbol=IBM | Company Presentation Premium",
  "stock_social_sentiment | GET | /stock/social-sentiment?symbol=GME | Social Sentiment Premium",
  "stock_investment_theme | GET | /stock/investment-theme?theme=financialExchangesData | Investment Themes Premium",
  "stock_supply_chain | GET | /stock/supply-chain?symbol=AAPL | Supply Chain Relationships Premium",
  "company_esg_score | GET | /stock/esg?symbol=AAPL | Company ESG Scores Premium",
  "company_historical_esg_score | GET | /stock/historical-esg?symbol=AAPL | Historical ESG Scores Premium",
  "company_earnings_quality_score | GET | /stock/earnings-quality-score?symbol=AAPL&freq=quarterly | Company Earnings Quality Score Premium",
  "stock_uspto_patent | GET | /stock/uspto-patent?symbol=NVDA&from=2021-01-01&to=2021-12-31 | USPTO Patents",
  "stock_visa_application | GET | /stock/visa-application?symbol=AAPL&from=2025-01-01&to=2025-12-31 | H1-B Visa Application",
  "stock_lobbying | GET | /stock/lobbying?symbol=AAPL&from=2021-01-01&to=2022-12-31 | Senate Lobbying",
  "stock_usa_spending | GET | /stock/usa-spending?symbol=LMT&from=2021-01-01&to=2022-12-31 | USA Spending",
  "congressional_trading | GET | /stock/congressional-trading?symbol=AAPL | Congressional Trading Premium",
  "bank_branch | GET | /bank-branch?symbol=JPM | Bank Branch List Premium",
  "fda_calendar | GET | /fda-advisory-committee-calendar | FDA Committee Meeting Calendar",
  "stock_revenue_breakdown2 | GET | /stock/revenue-breakdown2?symbol=AAPL | Revenue Breakdown & KPI Premium",
  "newsroom | GET | /stock/newsroom?symbol=AAPL | Newsroom Premium",
  "international_filings | GET | /stock/international-filings?symbol=RY.TO | International Filings Premium",
  "country | GET | /country | Country Metadata",
  "calendar_economic | GET | /calendar/economic | Economic Calendar Premium",
  "economic_code | GET | /economic/code | Economic Code Premium",
  "economic_data | GET | /economic?code=MA-USA-656880 | Economic Data Premium",
  "ai_chat | GET | /ai-chat | AI Copilot Premium",
  "global_filings_search | POST | /global-filings/search | Global Filings Search Premium",
  "global_filings_search_in_filing | POST | /global-filings/search-in-filing | Search In Filing Premium",
  "global_filings_filter | GET | /global-filings/filter?field=forms&source=SEC | Search Filter Premium",
  "global_filings_download | GET | /global-filings/download?documentId=AAPL_1113753 | Download Filings Premium",
] as const;

export type FinnhubRestEndpointCatalogEntry =
  (typeof FINNHUB_REST_ENDPOINT_CATALOG)[number];

export type FinnhubAccessLevel = "free" | "premium";

export type FinnhubRestEndpointMetadata = {
  id: string;
  method: string;
  path: string;
  title: string;
  access: FinnhubAccessLevel;
  purpose: string;
};

export function isFinnhubPremiumCatalogEntry(
  entry: FinnhubRestEndpointCatalogEntry | string,
): boolean {
  return /\bpremium\b/i.test(entry);
}

export function finnhubCatalogForAccess(input: {
  premiumAccess?: boolean;
} = {}): FinnhubRestEndpointCatalogEntry[] {
  return FINNHUB_REST_ENDPOINT_CATALOG.filter(
    (entry) => input.premiumAccess || !isFinnhubPremiumCatalogEntry(entry),
  );
}

export function finnhubEndpointCatalogForAccess(input: {
  premiumAccess?: boolean;
} = {}): FinnhubRestEndpointMetadata[] {
  return finnhubCatalogForAccess(input).map(parseFinnhubCatalogEntry);
}

export function parseFinnhubCatalogEntry(
  entry: FinnhubRestEndpointCatalogEntry | string,
): FinnhubRestEndpointMetadata {
  const [rawId, rawMethod, rawPath, rawTitle] = entry
    .split("|")
    .map((part) => part.trim());
  const access = isFinnhubPremiumCatalogEntry(entry) ? "premium" : "free";
  const title = (rawTitle ?? rawId).replace(/\s+Premium\b/i, "").trim();

  return {
    id: rawId,
    method: rawMethod,
    path: normalizeFinnhubPath(rawPath),
    title,
    access,
    purpose: `Returns ${title.toLowerCase()} data from Finnhub.`,
  };
}

export function isFinnhubPremiumPath(path: string): boolean {
  const normalizedPath = normalizeFinnhubPath(path);
  return FINNHUB_REST_ENDPOINT_CATALOG.some(
    (entry) =>
      isFinnhubPremiumCatalogEntry(entry) &&
      normalizeFinnhubPath(catalogPath(entry)) === normalizedPath,
  );
}

function catalogPath(entry: string): string {
  return entry.split("|")[2]?.trim() ?? "";
}

function normalizeFinnhubPath(path: string): string {
  return new URL(path, "https://finnhub.io").pathname;
}
