import type {
  EscalationEvent,
  HeartbeatOutput,
  HeartbeatSeedBundle,
  HeartbeatToolTrace,
} from "../agents/heartbeat/types.js";
import { retryFetch } from "../global/retry.js";
import { recordProviderUsage } from "../global/usage.js";

export type SupermemoryConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  retryAttempts?: number;
};

export type SupermemorySearchMode = "memories" | "documents" | "hybrid";
export type SupermemoryMetadata = Record<string, string | number | boolean>;

export type SupermemoryAddContentRequest = {
  content: string;
  containerTag: string;
  customId?: string;
  metadata?: SupermemoryMetadata;
  entityContext?: string;
};

export type SupermemoryAddContentResponse = {
  id: string;
  status: "queued" | "processing" | "done" | "failed" | string;
};

export type SupermemoryCreateMemory = {
  content: string;
  isStatic?: boolean;
  metadata?: SupermemoryMetadata;
};

export type SupermemoryCreateMemoriesRequest = {
  containerTag: string;
  memories: SupermemoryCreateMemory[];
};

export type SupermemoryCreateMemoriesResponse = {
  documentId: string | null;
  memories: Array<{
    id: string;
    memory: string;
    isStatic: boolean;
    createdAt: string;
  }>;
};

export type SupermemoryUpdateMemoryRequest = {
  id?: string;
  content?: string;
  newContent: string;
  metadata?: SupermemoryMetadata;
};

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
  private readonly retryAttempts: number;

  constructor(config: SupermemoryConfig = {}) {
    const { apiKey, baseUrl, fetchImpl, retryAttempts } = config;
    this.apiKey = apiKey ?? process.env.SUPERMEMORY_API_KEY ?? "";
    this.baseUrl = baseUrl ?? "https://api.supermemory.ai";
    this.fetchImpl = fetchImpl ?? fetch;
    this.retryAttempts = retryAttempts ?? 3;

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

  addContent(
    request: SupermemoryAddContentRequest,
  ): Promise<SupermemoryAddContentResponse> {
    return this.post("/v3/documents", request);
  }

  createMemories(
    request: SupermemoryCreateMemoriesRequest,
  ): Promise<SupermemoryCreateMemoriesResponse> {
    return this.post("/v4/memories", request);
  }

  updateMemory(request: SupermemoryUpdateMemoryRequest): Promise<unknown> {
    return this.request("PATCH", "/v4/memories", request);
  }

  forgetMemory(memoryId: string): Promise<unknown> {
    return this.request("POST", `/v4/memories/${encodeURIComponent(memoryId)}/forget`);
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

  writeHeartbeatOutput(input: {
    containerTag: string;
    output: HeartbeatOutput;
    seedBundle?: HeartbeatSeedBundle;
    metadata?: SupermemoryMetadata;
  }): Promise<SupermemoryCreateMemoriesResponse> {
    const { containerTag, output, seedBundle, metadata } = input;

    return this.createMemories({
      containerTag,
      memories: [
        {
          content: `Heartbeat for branch ${output.branch_id} returned ${output.decision}: ${output.summary}`,
          isStatic: false,
          metadata: compactMetadata({
            type: "heartbeat_output",
            branch_id: output.branch_id,
            timestamp: output.timestamp,
            decision: output.decision,
            asset_count: seedBundle?.assets.length,
            ...metadata,
          }),
        },
      ],
    });
  }

  writeEscalationEvent(input: {
    containerTag: string;
    event: EscalationEvent;
    metadata?: SupermemoryMetadata;
  }): Promise<SupermemoryAddContentResponse> {
    const { containerTag, event, metadata } = input;

    return this.addContent({
      containerTag,
      customId: safeCustomId(
        `heartbeat-escalation:${event.branchId}:${event.timestamp}`,
      ),
      content: JSON.stringify(compactEscalationEventForMemory(event), null, 2),
      metadata: compactMetadata({
        type: "heartbeat_escalation",
        branch_id: event.branchId,
        timestamp: event.timestamp,
        ...metadata,
      }),
    });
  }

  writeConversation(input: {
    containerTag: string;
    customId: string;
    content?: string;
    messages?: Array<{
      role: string;
      content: string;
      name?: string;
      timestamp?: string;
    }>;
    metadata?: SupermemoryMetadata;
  }): Promise<SupermemoryAddContentResponse> {
    const { containerTag, customId, content, messages, metadata } = input;
    const mirroredMessages = messages?.filter(({ role }) => !isPromptRole(role));

    return this.addContent({
      containerTag,
      customId,
      content: content ?? formatConversation(mirroredMessages ?? []),
      metadata: compactMetadata({
        type: "conversation",
        message_count: mirroredMessages?.length,
        ...metadata,
      }),
    });
  }

  writeToolTraces(input: {
    containerTag: string;
    traces: HeartbeatToolTrace[];
    metadata?: SupermemoryMetadata;
  }): Promise<SupermemoryCreateMemoriesResponse> {
    return this.createMemories({
      containerTag: input.containerTag,
      memories: input.traces.map((trace) => ({
        content: `Heartbeat tool ${trace.toolName} for branch ${trace.branchId}${
          trace.error ? ` failed: ${trace.error}` : " completed"
        }`,
        isStatic: false,
        metadata: compactMetadata({
          type: "heartbeat_tool_trace",
          branch_id: trace.branchId,
          timestamp: trace.timestamp,
          tool_name: trace.toolName,
          failed: Boolean(trace.error),
          ...input.metadata,
        }),
      })),
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request("POST", path, body);
  }

  private async request<T>(
    method: "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const startedAt = Date.now();
    const operation = `${method} ${path}`;
    const response = await retryFetch(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { attempts: this.retryAttempts },
    );

    if (!response.ok) {
      const text = await response.text();
      await recordProviderUsage({
        provider: "supermemory",
        operation,
        status: "failed",
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        quotaUnits: 1,
        unit: "request",
        metadata: {
          error: text.slice(0, 500),
        },
      });
      throw new Error(`Supermemory ${response.status}: ${text}`);
    }

    const payload = await response.json() as T;
    await recordProviderUsage({
      provider: "supermemory",
      operation,
      status: "succeeded",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      quotaUnits: 1,
      unit: "request",
      metadata: summarizeSupermemoryPayload(payload),
    });
    return payload;
  }
}

function summarizeSupermemoryPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  return {
    resultCount: Array.isArray(record.results) ? record.results.length : undefined,
    memoryCount: Array.isArray(record.memories) ? record.memories.length : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    timing: typeof record.timing === "number" ? record.timing : undefined,
    total: typeof record.total === "number" ? record.total : undefined,
  };
}

function safeCustomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, "_");
}

function formatConversation(
  messages: Array<{ role: string; content: string; name?: string; timestamp?: string }>,
): string {
  return messages
    .map(({ role, content, name, timestamp }) => {
      const speaker = name ? `${role}:${name}` : role;
      const prefix = timestamp ? `[${timestamp}] ${speaker}` : speaker;
      return `${prefix}: ${content}`;
    })
    .join("\n");
}

function compactMetadata(
  metadata: Record<string, string | number | boolean | undefined>,
): SupermemoryMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string | number | boolean] => {
      return entry[1] !== undefined && !isPromptLikeKey(entry[0]);
    }),
  );
}

function compactEscalationEventForMemory(
  event: EscalationEvent,
): Record<string, unknown> {
  return {
    type: "heartbeat_escalation",
    branchId: event.branchId,
    timestamp: event.timestamp,
    status: event.status,
    heartbeatOutput: sanitizeMemoryPayload(event.heartbeatOutput),
    seedSummary: compactSeedBundleForMemory(event.seedBundle),
  };
}

function compactSeedBundleForMemory(
  seedBundle: HeartbeatSeedBundle,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    branchId: seedBundle.branchId,
    timestamp: seedBundle.timestamp,
    law: seedBundle.law,
    assets: seedBundle.assets,
    seedWindowDays: seedBundle.seedWindowDays,
    generalMarketNewsWindowDays: seedBundle.generalMarketNewsWindowDays,
    supermemoryContainerTag: seedBundle.supermemoryContainerTag,
    supermemoryProfileContainerTag: seedBundle.supermemoryProfileContainerTag,
    defaultSourceKeys: Object.keys(seedBundle.defaultSources),
    optionalSourceKeys: Object.keys(seedBundle.optionalData).filter(
      (key) => !isPromptLikeKey(key),
    ),
    priorDecisionCount: seedBundle.priorDecisions.length,
  };
  return sanitizeMemoryPayload(summary) as Record<string, unknown>;
}

function sanitizeMemoryPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMemoryPayload);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPromptLikeKey(key))
      .map(([key, entry]) => [key, sanitizeMemoryPayload(entry)]),
  );
}

function isPromptRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return normalized === "system" || normalized === "developer";
}

function isPromptLikeKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normalized === "system" ||
    normalized === "developer" ||
    normalized === "prompt" ||
    normalized === "prompts" ||
    normalized === "trustedtask" ||
    normalized === "instructions" ||
    normalized.endsWith("prompt") ||
    normalized.endsWith("prompts") ||
    normalized.endsWith("instructions");
}
