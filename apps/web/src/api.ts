import type {
  KairosBranchAgentConfig,
  KairosConfigModelRole,
  KairosReasoningEffort,
} from "../../../src/global/agent-config.js";

export type JsonRecord = Record<string, unknown>;
export type TradingMode = "disabled" | "paper";
export type AllowedOrderType = "market" | "limit";

export type BranchTradingConfig = {
  mode?: TradingMode;
  symbol?: string;
  symbols?: string[];
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
  kind: "heartbeat" | "debate" | "router";
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

export type ModelRoleDefaults = Partial<
  Record<
    KairosConfigModelRole,
    {
      model: string;
      reasoningEffort?: KairosReasoningEffort;
    }
  >
>;

export type PortfolioSnapshot = {
  account?: JsonRecord;
  positions: JsonRecord[];
  orders: JsonRecord[];
  storage?: JsonRecord;
  updatedAt?: string;
  paper?: boolean;
  status?: string;
  error?: string;
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

export type RouterChatRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type RouterAttachmentRecord = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
};

export type RouterMessageRecord = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  createdAt: string;
  text?: string;
  attachments?: RouterAttachmentRecord[];
  runId?: string;
  toolCalls?: RouterToolCallRecord[];
};

export type RouterToolCallRecord = {
  id: string;
  name: string;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  input?: JsonRecord;
  output?: JsonRecord;
  error?: string;
  createdAt: string;
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

export async function createBranch(input: {
  id?: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  law?: JsonRecord;
  config?: WebBranchConfig;
  metadata?: JsonRecord;
}): Promise<BranchRecord> {
  return request<{ branch: BranchRecord }>("/branches", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((response) => response.branch);
}

export async function getRuns(): Promise<RunRecord[]> {
  return request<{ runs: RunRecord[] }>("/runs").then((response) => response.runs);
}

export async function getRunEvents(runId: string): Promise<RunEventRecord[]> {
  return request<{ events: RunEventRecord[] }>(`/runs/${runId}/events`).then(
    (response) => response.events,
  );
}

export async function getOpenRouterModels(): Promise<{
  models: OpenRouterModelRecord[];
  defaults: ModelRoleDefaults;
}> {
  return request<{
    models: OpenRouterModelRecord[];
    defaults?: ModelRoleDefaults;
  }>("/openrouter/models").then((response) => ({
    models: response.models,
    defaults: response.defaults ?? {},
  }));
}

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  return request<JsonRecord>("/portfolio?refresh=true").then(normalizePortfolioResponse);
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

export async function getRouterChats(): Promise<RouterChatRecord[]> {
  return request<{ chats: RouterChatRecord[] }>("/router/chats").then(
    (response) => response.chats,
  );
}

export async function createRouterChat(): Promise<RouterChatRecord> {
  return request<{ chat: RouterChatRecord }>("/router/chats", {
    method: "POST",
    body: JSON.stringify({}),
  }).then((response) => response.chat);
}

export async function getRouterMessages(
  chatId: string,
): Promise<RouterMessageRecord[]> {
  return request<{ messages: RouterMessageRecord[] }>(
    `/router/chats/${chatId}/messages`,
  ).then((response) => response.messages);
}

export async function sendRouterMessage(input: {
  chatId: string;
  text: string;
  dryRun?: boolean;
}): Promise<{
  userMessage: RouterMessageRecord;
  assistantMessage: RouterMessageRecord;
  run: RunRecord;
  heartbeatRuns: RunRecord[];
}> {
  return request<{
    userMessage: RouterMessageRecord;
    assistantMessage: RouterMessageRecord;
    run: RunRecord;
    heartbeatRuns: RunRecord[];
  }>(`/router/chats/${input.chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      dryRun: input.dryRun ?? false,
    }),
  });
}

export async function triggerHeartbeat(
  branchId: string,
  input: JsonRecord = {},
  options: { dryRun?: boolean } = {},
): Promise<RunRecord> {
  return request<{ run: RunRecord }>(`/branches/${branchId}/heartbeat-runs`, {
    method: "POST",
    body: JSON.stringify({ dryRun: options.dryRun ?? false, input }),
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
      dryRun: input.dryRun ?? false,
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
    name?: string;
    enabled?: boolean;
    description?: string;
    law?: JsonRecord;
    config?: WebBranchConfig;
    metadata?: JsonRecord;
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
    storage: isJsonRecord(portfolio.storage)
      ? portfolio.storage
      : isJsonRecord(response.storage)
        ? response.storage
        : undefined,
    updatedAt: readString(portfolio.updatedAt) ?? readString(response.updatedAt),
    paper: readBoolean(portfolio.paper) ?? readBoolean(response.paper),
    status: readString(portfolio.status) ?? readString(response.status),
    error: readString(portfolio.error) ?? readString(response.error),
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
