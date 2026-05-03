import { Exa } from "exa-js";

export type ExaConfig = {
  apiKey?: string;
  client?: ExaSdkClient;
};

export type ExaSearchRequest = {
  query: string;
  numResults?: number;
  category?: "news" | "company" | "research paper" | "github" | "tweet";
  startPublishedDate?: string;
  endPublishedDate?: string;
};

export type ExaSearchResult = {
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  summary?: string;
};

export type ExaSearchResponse = {
  results: ExaSearchResult[];
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

  constructor(config: ExaConfig = {}) {
    const apiKey = config.apiKey ?? process.env.EXA_API_KEY;
    if (!config.client && !apiKey) {
      throw new Error("EXA_API_KEY is required.");
    }

    this.client = config.client ?? new Exa(apiKey) as ExaSdkClient;
  }

  async search(request: ExaSearchRequest): Promise<ExaSearchResponse> {
    const data = await this.client.search(request.query, {
      type: "auto",
      numResults: request.numResults ?? 10,
      category: request.category ?? "news",
      startPublishedDate: request.startPublishedDate,
      endPublishedDate: request.endPublishedDate,
      contents: {
        highlights: {
          query: "market-moving facts, dates, numbers, guidance, and management quotes",
          maxCharacters: 1000,
        },
        summary: {
          query: "Summarize the market-relevant headline and catalyst in 1-2 sentences.",
        },
        text: {
          maxCharacters: 2000,
        },
      },
    });

    return {
      results: data.results.map((result: ExaSearchResult) => ({
        title: result.title,
        url: result.url,
        publishedDate: result.publishedDate,
        author: result.author,
        highlights: result.highlights,
        summary: result.summary ?? result.highlights?.join(" "),
      })),
    };
  }

  async answer(input: {
    query: string;
    text?: boolean;
  }): Promise<ExaAnswerResponse> {
    if (!this.client.answer) {
      throw new Error("Exa SDK client does not expose answer().");
    }

    return this.client.answer(input.query, { text: input.text ?? true });
  }

  async contents(input: {
    urls: string[];
    maxCharacters?: number;
  }): Promise<ExaContentsResponse> {
    const data = await this.client.getContents(input.urls, {
      text: {
        maxCharacters: input.maxCharacters ?? 10_000,
      },
      highlights: true,
      summary: true,
    });

    return {
      results: "contents" in data ? data.contents : data.results,
    };
  }
}
