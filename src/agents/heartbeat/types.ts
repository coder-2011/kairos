import type { HeartbeatTimingConfig } from "../../global/heartbeat-timing.js";

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
   * Production default is false. Set true only for tests or degraded
   * probes where running with a partial packet is explicitly acceptable.
   */
  allowPartialSeedBundle?: boolean;
};

export type HeartbeatSeedSource =
  | "currentPrice"
  | "recentVolume"
  | "tickerMovement"
  | "supermemoryContext"
  | "deepResearchMemoryContext"
  | "newsHeadlinesAndSummaries"
  | "generalMarketNews";

export const defaultHeartbeatSeedSources: readonly HeartbeatSeedSource[] = [
  "currentPrice",
  "recentVolume",
  "tickerMovement",
  "supermemoryContext",
  "deepResearchMemoryContext",
  "newsHeadlinesAndSummaries",
  "generalMarketNews",
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
    timing?: HeartbeatTimingConfig;
    maxSearchCalls?: number;
    maxMemoryQueries?: number;
  };
  seededData?: {
    /**
     * Finnhub market news is returned as the latest feed with no server-side
     * date range. Filter the general category locally to this branch window.
     */
    generalMarketNewsWindowDays?: number;
    /**
     * Future UI-configured inputs. Keep this generic because the optional
     * source list is expected to grow substantially.
   */
    optionalSources?: Record<string, boolean>;
  };
  memory?: {
    /**
     * Supermemory containerTag. If omitted, the runtime derives one from the
     * branch ID. This is retained for raw branch document grouping.
     */
    supermemoryContainerTag?: string;
    /**
     * Supermemory user-profile containerTag for this branch. If omitted, the
     * runtime derives a branch-specific profile tag from the branch ID so each
     * branch gets its own Supermemory profile.
     */
    supermemoryProfileContainerTag?: string;
  };
};

export type NewsHeadlineSummary = {
  title: string;
  summary?: string;
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
  generalMarketNewsWindowDays: number;
  supermemoryContainerTag: string;
  supermemoryProfileContainerTag: string;
  defaultSources: Partial<Record<HeartbeatSeedSource, unknown | null>>;
  priorDecisions: HeartbeatPriorDecision[];
  optionalData: Record<string, unknown>;
};

export type HeartbeatSeedRequest = {
  branch: BranchConfig;
  timestamp: string;
  seedWindowDays: number;
  generalMarketNewsWindowDays: number;
  supermemoryContainerTag: string;
  supermemoryProfileContainerTag: string;
};

export type OptionalSeedDataRequest = HeartbeatSeedRequest & {
  sourceKey: string;
};

export type HeartbeatSeedDataProviders = {
  getCurrentPrice?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getRecentVolume?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getTickerMovement?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getSupermemoryContext?: (request: HeartbeatSeedRequest) => Promise<unknown>;
  getDeepResearchMemoryContext?: (
    request: HeartbeatSeedRequest,
  ) => Promise<unknown>;
  getNewsHeadlinesAndSummaries?: (
    request: HeartbeatSeedRequest,
  ) => Promise<NewsHeadlineSummary[] | unknown>;
  getGeneralMarketNews?: (
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
