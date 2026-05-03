export type HeartbeatDecision = "no_escalation" | "escalate";

export type HeartbeatOutput = {
  branch_id: string;
  timestamp: string;
  decision: HeartbeatDecision;
  summary: string;
};

export type HeartbeatToolTrace = {
  branchId: string;
  timestamp: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type HeartbeatToolName =
  | "supermemory_profile"
  | "supermemory_search"
  | "exa_news_search";

export type HeartbeatPromptSet = {
  systemPrompt?: string;
};

export type HeartbeatSeedPolicy = {
  /**
   * Production default is false. Set true only for tests, dry-runs, or degraded
   * probes where running with a partial packet is explicitly acceptable.
   */
  allowPartialSeedBundle?: boolean;
};

export type HeartbeatSeedSource =
  | "currentPrice"
  | "recentVolume"
  | "tickerMovement"
  | "supermemoryContext"
  | "newsHeadlinesAndSummaries";

export const defaultHeartbeatSeedSources: readonly HeartbeatSeedSource[] = [
  "currentPrice",
  "recentVolume",
  "tickerMovement",
  "supermemoryContext",
  "newsHeadlinesAndSummaries",
] as const;

export type BranchConfig = {
  id: string;
  name?: string;
  law: string;
  assets: string[];
  heartbeat: {
    enabled: boolean;
    intervalMinutes: number;
    seedWindowDays: number;
    model: string;
    maxSearchCalls?: number;
    maxMemoryQueries?: number;
  };
  seededData?: {
    /**
     * Future UI-configured inputs. Keep this generic because the optional
     * source list is expected to grow substantially.
   */
    optionalSources?: Record<string, boolean>;
  };
  memory?: {
    /**
     * Supermemory containerTag. If omitted, the runtime derives one from the
     * branch ID.
     */
    supermemoryContainerTag?: string;
  };
};

export type NewsHeadlineSummary = {
  title: string;
  summary: string;
  source?: string;
  publishedAt?: string;
  url?: string;
};

export type HeartbeatPriorDecision = {
  id?: string;
  memory: string;
  similarity?: number;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type HeartbeatSeedBundle = {
  branchId: string;
  timestamp: string;
  law: string;
  assets: string[];
  seedWindowDays: number;
  defaultSources: Record<HeartbeatSeedSource, unknown | null>;
  priorDecisions: HeartbeatPriorDecision[];
  optionalData: Record<string, unknown>;
};

export type HeartbeatSeedRequest = {
  branch: BranchConfig;
  timestamp: string;
  seedWindowDays: number;
  supermemoryContainerTag: string;
};

export type OptionalSeedDataRequest = HeartbeatSeedRequest & {
  sourceKey: string;
};

export type HeartbeatSeedDataProviders = {
  getCurrentPrice?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getRecentVolume?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getTickerMovement?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getSupermemoryContext?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getNewsHeadlinesAndSummaries?: (
    request: HeartbeatSeedRequest,
  ) => Promise<NewsHeadlineSummary[] | unknown>;
  getPriorDecisions?: (
    request: HeartbeatSeedRequest,
  ) => Promise<HeartbeatPriorDecision[]>;
  getOptionalData?: (request: OptionalSeedDataRequest) => Promise<unknown>;
};

export type EscalationEvent = {
  branchId: string;
  timestamp: string;
  status: "pending_big_model";
  heartbeatOutput: HeartbeatOutput;
  seedBundle: HeartbeatSeedBundle;
};

export type HeartbeatMemoryWriter = {
  writeHeartbeatOutput?: (input: {
    containerTag: string;
    output: HeartbeatOutput;
    seedBundle: HeartbeatSeedBundle;
  }) => Promise<unknown>;
  writeEscalationEvent?: (input: {
    containerTag: string;
    event: EscalationEvent;
  }) => Promise<unknown>;
  writeToolTraces?: (input: {
    containerTag: string;
    traces: HeartbeatToolTrace[];
  }) => Promise<unknown>;
};
