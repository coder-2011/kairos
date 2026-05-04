import { Exa } from "exa-js";
import { withRetry } from "../global/retry.js";

export type ExaSearchType =
  | "auto"
  | "fast"
  | "instant"
  | "deep-lite"
  | "deep"
  | "deep-reasoning";

export type ExaSearchTextOptions = {
  maxCharacters?: number;
  includeHtmlTags?: boolean;
  verbosity?: "compact" | "standard" | "full";
  includeSections?: Array<
    "header" | "navigation" | "banner" | "body" | "sidebar" | "footer" | "metadata"
  >;
  excludeSections?: Array<
    "header" | "navigation" | "banner" | "body" | "sidebar" | "footer" | "metadata"
  >;
};

export type ExaSearchHighlightsOptions = {
  query?: string;
  maxCharacters?: number;
};

export type ExaSearchSummaryOptions = {
  query?: string;
  schema?: Record<string, unknown>;
};

export type ExaSearchExtrasOptions = {
  links?: number;
  imageLinks?: number;
};

export type ExaSearchContents = {
  text?: boolean | ExaSearchTextOptions;
  highlights?: boolean | ExaSearchHighlightsOptions;
  summary?: boolean | ExaSearchSummaryOptions;
  livecrawlTimeout?: number;
  maxAgeHours?: number;
  subpages?: number;
  subpageTarget?: string | string[];
  extras?: ExaSearchExtrasOptions;
};

export type ExaConfig = {
  apiKey?: string;
  client?: ExaSdkClient;
  retryAttempts?: number;
};

export type ExaSearchRequest = {
  query: string;
  numResults?: number;
  type?: ExaSearchType;
  stream?: boolean;
  category?:
    | "news"
    | "company"
    | "research paper"
    | "personal site"
    | "financial report"
    | "people";
  userLocation?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  moderation?: boolean;
  additionalQueries?: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  contents?: ExaSearchContents;
};

export type ExaSearchResult = {
  title?: string;
  url: string;
  id?: string;
  publishedDate?: string;
  author?: string;
  image?: string;
  favicon?: string;
  highlights?: string[];
  summary?: string;
  text?: string;
  subpages?: ExaSearchResult[];
  extras?: {
    links?: string[];
    imageLinks?: string[];
  };
};

export type ExaSearchOutputGrounding = {
  field: string;
  citations?: Array<{
    url: string;
    title?: string;
  }>;
  confidence?: "low" | "medium" | "high";
};

export type ExaSearchOutput = {
  content?: string | Record<string, unknown>;
  grounding?: ExaSearchOutputGrounding[];
};

export type ExaSearchResponse = {
  requestId?: string;
  searchType?: string;
  results: ExaSearchResult[];
  output?: ExaSearchOutput;
  costDollars?: {
    total?: number;
  };
};

export type ExaAnswerCitation = {
  id?: string;
  url: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  text?: string;
};

export type ExaAnswerResponse = {
  answer: string;
  citations: ExaAnswerCitation[];
};

export type ExaContentsResult = ExaSearchResult & {
  text?: string;
  id?: string;
};

export type ExaContentsResponse = {
  results: ExaContentsResult[];
};

export type ExaSdkClient = {
  search: (
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<ExaSearchResponse>;
  getContents: (
    urls: string[] | string,
    options?: Record<string, unknown>,
  ) => Promise<ExaContentsResponse | { contents: ExaContentsResult[] }>;
  answer?: (
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<ExaAnswerResponse>;
};

export class ExaApi {
  private readonly client: ExaSdkClient;
  private readonly retryAttempts: number;
  private readonly apiKey: string;
  private readonly useSdkSearch: boolean;

  constructor(config: ExaConfig = {}) {
    const apiKey = config.apiKey ?? process.env.EXA_API_KEY;
    if (!config.client && !apiKey) {
      throw new Error("EXA_API_KEY is required.");
    }

    this.client = config.client ?? new Exa(apiKey) as ExaSdkClient;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.apiKey = apiKey ?? "";
    this.useSdkSearch = Boolean(config.client);
  }

  async search(request: ExaSearchRequest): Promise<ExaSearchResponse> {
    const category = normalizeExaCategory(request.category);
    const normalizedRequest = buildSearchRequest(request, category);
    const data = await withRetry(
      () =>
        this.useSdkSearch
          ? this.client.search(request.query, normalizedRequest)
          : this.requestJson("/search", {
          query: request.query,
          ...normalizedRequest,
        }),
      { attempts: this.retryAttempts },
    );

    return normalizeSearchResponse(data);
  }

  async answer(input: {
    query: string;
    text?: boolean;
  }): Promise<ExaAnswerResponse> {
    if (!this.client.answer) {
      throw new Error("Exa SDK client does not expose answer().");
    }

    return withRetry(
      () => this.client.answer!(input.query, { text: input.text ?? true }),
      { attempts: this.retryAttempts },
    );
  }

  async deepResearch(request: Omit<ExaSearchRequest, "type">): Promise<ExaSearchResponse> {
    return this.search({
      ...request,
      type: "deep",
      contents: request.contents ?? {
        highlights: true,
        text: {
          maxCharacters: 10_000,
          verbosity: "standard",
        },
      },
    });
  }

  async contents(input: {
    urls: string[];
    maxCharacters?: number;
  }): Promise<ExaContentsResponse> {
    const data = await withRetry(
      () =>
        this.client.getContents(input.urls, {
          text: {
            maxCharacters: input.maxCharacters ?? 10_000,
          },
          highlights: true,
          summary: true,
        }),
      { attempts: this.retryAttempts },
    );

    return {
      results: "contents" in data ? data.contents : data.results,
    };
  }

  private async requestJson<T>(path: "/search", request: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.exa.ai${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(request),
    });

    const responseText = await response.text();
    if (!response.ok) {
      const truncated = responseText.slice(0, 1200);
      throw new Error(
        `Exa API ${path} returned ${response.status}: ${truncated}`,
      );
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (error) {
      throw new Error(
        `Exa API ${path} returned non-JSON response: ${error instanceof Error ? error.message : String(error)}. ` +
          `Body preview: ${responseText.slice(0, 1200)}`,
      );
    }
  }
}

function buildSearchRequest(
  request: ExaSearchRequest,
  category?: ExaSearchRequest["category"],
): Record<string, unknown> {
  const normalizedIncludeDomains = category === "people"
    ? sanitizePeopleIncludeDomains(request.includeDomains)
    : request.includeDomains;
  const supportsRestrictedFilters = category !== "company" && category !== "people";

  const defaultContents: ExaSearchContents = {
    highlights: {
      query: "market-moving facts, dates, numbers, and management quotes",
      maxCharacters: 1000,
    },
    summary: {
      query: "Summarize the market-relevant headline and catalyst in 1-2 sentences.",
    },
  };

  return {
    type: request.type ?? "auto",
    numResults: request.numResults ?? 10,
    stream: request.stream,
    ...(category ? { category } : {}),
    userLocation: request.userLocation,
    includeDomains: normalizedIncludeDomains,
    excludeDomains: supportsRestrictedFilters ? request.excludeDomains : undefined,
    startPublishedDate: supportsRestrictedFilters ? request.startPublishedDate : undefined,
    endPublishedDate: supportsRestrictedFilters ? request.endPublishedDate : undefined,
    startCrawlDate: supportsRestrictedFilters ? request.startCrawlDate : undefined,
    endCrawlDate: supportsRestrictedFilters ? request.endCrawlDate : undefined,
    moderation: request.moderation,
    additionalQueries: request.additionalQueries,
    systemPrompt: request.systemPrompt,
    outputSchema: request.outputSchema,
    contents: request.contents ?? defaultContents,
  };
}

function normalizeSearchResponse(
  response: ExaSearchResponse,
): ExaSearchResponse {
  const results = Array.isArray(response.results)
    ? response.results.map((result) => ({
      title: result.title,
      url: result.url,
      publishedDate: result.publishedDate,
      author: result.author,
      highlights: result.highlights,
      summary: result.summary ?? result.highlights?.join(" "),
      id: result.id,
      image: result.image,
      favicon: result.favicon,
      text: result.text,
      subpages: result.subpages,
      extras: result.extras,
    }))
    : [];

  return {
    requestId: response.requestId,
    searchType: response.searchType,
    results,
    output: response.output,
    costDollars: response.costDollars,
  };
}

function normalizeExaCategory(
  category?:
    | ExaSearchRequest["category"]
    | "github"
    | "tweet",
): ExaSearchRequest["category"] | undefined {
  if (!category) return undefined;
  if (category === "github" || category === "tweet") return undefined;
  return category;
}

function sanitizePeopleIncludeDomains(includeDomains?: string[]): string[] | undefined {
  if (!includeDomains?.length) return includeDomains;
  return includeDomains.filter((domain) => domain.endsWith("linkedin.com"));
}
