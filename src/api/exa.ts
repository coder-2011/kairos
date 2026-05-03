export type ExaConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type ExaSearchRequest = {
  query: string;
  numResults?: number;
  category?: "news" | "company" | "research paper" | "github" | "tweet";
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

export class ExaApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ExaConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.EXA_API_KEY ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.exa.ai";
    this.fetchImpl = config.fetchImpl ?? fetch;

    if (!this.apiKey) {
      throw new Error("EXA_API_KEY is required.");
    }
  }

  async search(request: ExaSearchRequest): Promise<ExaSearchResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: request.query,
        type: "auto",
        num_results: request.numResults ?? 10,
        category: request.category ?? "news",
        contents: {
          highlights: {
            max_characters: 2000,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as ExaSearchResponse;
    return {
      results: data.results.map((result) => ({
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
    const response = await this.fetchImpl(`${this.baseUrl}/answer`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        text: input.text ?? true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa answer ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<ExaAnswerResponse>;
  }

  async contents(input: {
    urls: string[];
    maxCharacters?: number;
  }): Promise<ExaContentsResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/contents`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: input.urls,
        text: {
          max_characters: input.maxCharacters ?? 10_000,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa contents ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<ExaContentsResponse>;
  }
}
