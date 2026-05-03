export type SupermemoryConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type SupermemorySearchMode = "memories" | "documents" | "hybrid";

export type SupermemorySearchRequest = {
  q: string;
  containerTag?: string;
  limit?: number;
  threshold?: number;
  rerank?: boolean;
  aggregate?: boolean;
  rewriteQuery?: boolean;
  searchMode?: SupermemorySearchMode;
  filters?: Record<string, unknown>;
};

export type SupermemoryProfileRequest = {
  containerTag: string;
  q?: string;
  threshold?: number;
  filters?: Record<string, unknown>;
};

export type SupermemoryMemoryContext = {
  relation: "updates" | "extends" | "derives";
  memory: string;
  updatedAt?: string;
  version?: number;
  metadata?: Record<string, unknown>;
};

export type SupermemorySearchResult = {
  id: string;
  memory: string;
  similarity: number;
  version?: number;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  context?: {
    parents?: SupermemoryMemoryContext[];
    children?: SupermemoryMemoryContext[];
    related?: SupermemoryMemoryContext[];
  };
  documents?: Array<{
    id: string;
    title?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export type SupermemorySearchResponse = {
  results: SupermemorySearchResult[];
  timing?: number;
  total?: number;
};

export type SupermemoryProfileResponse = {
  profile: {
    static: string[];
    dynamic: string[];
  };
  searchResults?: SupermemorySearchResponse;
};

export class SupermemoryApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SupermemoryConfig = {}) {
    const { apiKey, baseUrl, fetchImpl } = config;
    this.apiKey = apiKey ?? process.env.SUPERMEMORY_API_KEY ?? "";
    this.baseUrl = baseUrl ?? "https://api.supermemory.ai";
    this.fetchImpl = fetchImpl ?? fetch;

    if (!this.apiKey) {
      throw new Error("SUPERMEMORY_API_KEY is required.");
    }
  }

  search(request: SupermemorySearchRequest): Promise<SupermemorySearchResponse> {
    return this.post("/v4/search", request);
  }

  profile(
    request: SupermemoryProfileRequest,
  ): Promise<SupermemoryProfileResponse> {
    return this.post("/v4/profile", request);
  }

  async getHeartbeatContext(input: {
    containerTag: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<SupermemoryProfileResponse & { search: SupermemorySearchResponse }> {
    const { containerTag, query, limit = 5, threshold = 0.6 } = input;
    const [profile, search] = await Promise.all([
      this.profile({
        containerTag,
        q: query,
        threshold,
      }),
      this.search({
        q: query,
        containerTag,
        limit,
        threshold,
        rerank: true,
        searchMode: "memories",
      }),
    ]);

    return { ...profile, search };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Supermemory ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }
}
