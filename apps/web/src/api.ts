import type { KairosBranchAgentConfig } from "../../../src/global/agent-config.js";

export type JsonRecord = Record<string, unknown>;
export type TradingMode = "disabled" | "paper";
export type AllowedOrderType = "market" | "limit" | "bracket";

export type BranchTradingConfig = {
  mode?: TradingMode;
  paperAutoBuyEnabled?: boolean;
  notifyOnBuySignal?: boolean;
  maxNotionalPerOrder?: number;
  maxOpenPositionNotionalPerSymbol?: number;
  allowedOrderType?: AllowedOrderType;
};

export type WebBranchConfig = KairosBranchAgentConfig & {
  trading?: BranchTradingConfig;
};

export type BranchRecord = {
  id: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  law?: JsonRecord;
  config?: WebBranchConfig;
  metadata?: JsonRecord;
};

export type RunRecord = {
  id: string;
  kind: "heartbeat" | "debate";
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  branchId?: string;
  createdAt: string;
  updatedAt: string;
  dryRun: boolean;
  input: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
};

export type RunEventRecord = {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  payload: JsonRecord;
};

export type OpenRouterModelRecord = {
  id: string;
  name: string;
  contextLength?: number;
  supportedParameters: string[];
  inputModalities: string[];
  outputModalities: string[];
};

export type PortfolioSnapshot = {
  account?: JsonRecord;
  positions: JsonRecord[];
  orders: JsonRecord[];
  updatedAt?: string;
  paper?: boolean;
  status?: string;
};

export type MessageRecord = JsonRecord & {
  id?: string;
  timestamp?: string;
  createdAt?: string;
  level?: string;
  type?: string;
  title?: string;
  summary?: string;
  message?: string;
};

export type TradeIntentRecord = JsonRecord & {
  id?: string;
  branchId?: string;
  symbol?: string;
  side?: string;
  status?: string;
  confidence?: number;
  notional?: number;
  orderType?: string;
  createdAt?: string;
  summary?: string;
  rationale?: string;
};

const apiBaseUrl =
  import.meta.env.VITE_KAIROS_API_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:4321";

export async function getBranches(): Promise<BranchRecord[]> {
  return request<{ branches: BranchRecord[] }>("/branches").then(
    (response) => response.branches,
  );
}

export async function getRuns(): Promise<RunRecord[]> {
  return request<{ runs: RunRecord[] }>("/runs").then((response) => response.runs);
}

export async function getRunEvents(runId: string): Promise<RunEventRecord[]> {
  return request<{ events: RunEventRecord[] }>(`/runs/${runId}/events`).then(
    (response) => response.events,
  );
}

export async function getOpenRouterModels(): Promise<OpenRouterModelRecord[]> {
  return request<{ models: OpenRouterModelRecord[] }>("/openrouter/models").then(
    (response) => response.models,
  );
}

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  return request<JsonRecord>("/portfolio").then(normalizePortfolioResponse);
}

export async function getMessages(): Promise<MessageRecord[]> {
  return request<JsonRecord>("/messages").then((response) =>
    readRecordArray(response, "messages") as MessageRecord[],
  );
}

export async function getTradeIntents(): Promise<TradeIntentRecord[]> {
  return request<JsonRecord>("/trade-intents").then((response) => {
    const records =
      readRecordArray(response, "tradeIntents") ??
      readRecordArray(response, "intents");

    return (records ?? []) as TradeIntentRecord[];
  });
}

export async function triggerHeartbeat(
  branchId: string,
  input: JsonRecord = {},
  options: { dryRun?: boolean } = {},
): Promise<RunRecord> {
  return request<{ run: RunRecord }>(`/branches/${branchId}/heartbeat-runs`, {
    method: "POST",
    body: JSON.stringify({ dryRun: options.dryRun ?? true, input }),
  }).then((response) => response.run);
}

export async function createDebate(input: {
  branchId?: string;
  escalation?: JsonRecord;
  dryRun?: boolean;
}): Promise<RunRecord> {
  return request<{ run: RunRecord }>("/debates", {
    method: "POST",
    body: JSON.stringify({
      dryRun: input.dryRun ?? true,
      escalation: input.escalation,
      input: { branchId: input.branchId },
    }),
  }).then((response) => response.run);
}

export async function appendInterjection(
  runId: string,
  message: string,
): Promise<RunEventRecord> {
  return request<{ event: RunEventRecord }>(`/runs/${runId}/interjections`, {
    method: "POST",
    body: JSON.stringify({ message }),
  }).then((response) => response.event);
}

export async function updateBranchConfig(
  branchId: string,
  config: WebBranchConfig,
): Promise<BranchRecord> {
  return updateBranch(branchId, { config });
}

export async function updateBranch(
  branchId: string,
  input: {
    description?: string;
    law?: JsonRecord;
    config?: WebBranchConfig;
  },
): Promise<BranchRecord> {
  return request<{ branch: BranchRecord }>(`/branches/${branchId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }).then((response) => response.branch);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Kairos API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizePortfolioResponse(response: JsonRecord): PortfolioSnapshot {
  const portfolio = isJsonRecord(response.portfolio)
    ? response.portfolio
    : response;

  return {
    account: isJsonRecord(portfolio.account) ? portfolio.account : undefined,
    positions: readRecordArray(portfolio, "positions") ?? [],
    orders: readRecordArray(portfolio, "orders") ?? [],
    updatedAt: readString(portfolio.updatedAt) ?? readString(response.updatedAt),
    paper: readBoolean(portfolio.paper) ?? readBoolean(response.paper),
    status: readString(portfolio.status) ?? readString(response.status),
  };
}

function readRecordArray(
  record: JsonRecord,
  key: string,
): JsonRecord[] | undefined {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => isJsonRecord(item))
    : undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
