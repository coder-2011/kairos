import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ProviderUsageStatus = "succeeded" | "failed" | "unknown";

export type ProviderUsageEvent = {
  id: string;
  provider: string;
  operation: string;
  status: ProviderUsageStatus;
  timestamp: string;
  requestId?: string;
  runId?: string;
  branchId?: string;
  providerRequestId?: string;
  statusCode?: number;
  durationMs?: number;
  model?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  quotaUnits?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
};

export type CreateProviderUsageEventInput = Omit<
  ProviderUsageEvent,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: string;
};

export type ProviderUsageSink = (
  event: ProviderUsageEvent,
) => Promise<void> | void;

export type UsageContext = {
  requestId?: string;
  runId?: string;
  branchId?: string;
  sink?: ProviderUsageSink;
};

const usageContext = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(
  context: UsageContext,
  callback: () => T,
): T {
  const existing = usageContext.getStore();
  return usageContext.run(
    {
      ...existing,
      ...context,
      sink: context.sink ?? existing?.sink,
    },
    callback,
  );
}

export function getUsageContext(): UsageContext | undefined {
  return usageContext.getStore();
}

export async function recordProviderUsage(
  input: CreateProviderUsageEventInput,
): Promise<ProviderUsageEvent | undefined> {
  const context = usageContext.getStore();
  const sink = context?.sink;
  if (!sink) return undefined;

  const event = compactUsageEvent({
    ...input,
    id: input.id ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    requestId: input.requestId ?? context.requestId,
    runId: input.runId ?? context.runId,
    branchId: input.branchId ?? context.branchId,
  });

  try {
    await sink(event);
  } catch (error) {
    console.warn("[kairos] provider usage sink failed", {
      provider: event.provider,
      operation: event.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return event;
}

export function openRouterUsageFromAiSdkResult(
  result: unknown,
  input: Omit<CreateProviderUsageEventInput, "provider" | "status"> & {
    status?: ProviderUsageStatus;
  },
): CreateProviderUsageEventInput {
  const record = isRecord(result) ? result : {};
  const usage = readUsage(record.totalUsage) ?? readUsage(record.usage);
  const response = isRecord(record.response) ? record.response : {};
  const costUsd =
    readNumber(usage?.cost) ??
    readNumber(record.cost) ??
    readNumber(response.cost);

  return {
    provider: "openrouter",
    status: input.status ?? "succeeded",
    operation: input.operation,
    requestId: input.requestId,
    runId: input.runId,
    branchId: input.branchId,
    providerRequestId:
      readString(response.id) ??
      readString(record.id) ??
      readString(record.responseId),
    model:
      input.model ??
      readString(response.modelId) ??
      readString(response.model) ??
      readString(record.modelId) ??
      readString(record.model),
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    costUsd,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    reasoningTokens: usage?.reasoningTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    metadata: {
      ...input.metadata,
      finishReason: readString(record.finishReason),
      warnings: Array.isArray(record.warnings) ? record.warnings.length : undefined,
    },
  };
}

export function openRouterUsageFromChatCompletionPayload(input: {
  payload: unknown;
  operation: string;
  model?: string;
  status: ProviderUsageStatus;
  statusCode?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): CreateProviderUsageEventInput {
  const payload = isRecord(input.payload) ? input.payload : {};
  const usage = readUsage(payload.usage);
  return {
    provider: "openrouter",
    operation: input.operation,
    status: input.status,
    providerRequestId: readString(payload.id),
    model: input.model ?? readString(payload.model),
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    reasoningTokens: usage?.reasoningTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    costUsd: usage?.cost,
    metadata: input.metadata,
  };
}

function compactUsageEvent(event: ProviderUsageEvent): ProviderUsageEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => {
      if (value === undefined) return false;
      if (isRecord(value)) {
        return Object.values(value).some((entry) => entry !== undefined);
      }
      return true;
    }),
  ) as ProviderUsageEvent;
}

function readUsage(value: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cost?: number;
} | undefined {
  if (!isRecord(value)) return undefined;

  const inputTokens =
    readNumber(value.inputTokens) ??
    readNumber(value.promptTokens) ??
    readNumber(value.prompt_tokens);
  const outputTokens =
    readNumber(value.outputTokens) ??
    readNumber(value.completionTokens) ??
    readNumber(value.completion_tokens);
  const totalTokens =
    readNumber(value.totalTokens) ??
    readNumber(value.total_tokens) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const details = isRecord(value.details) ? value.details : {};

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens:
      readNumber(value.reasoningTokens) ??
      readNumber(value.reasoning_tokens) ??
      readNumber(details.reasoningTokens) ??
      readNumber(details.reasoning_tokens),
    cachedInputTokens:
      readNumber(value.cachedInputTokens) ??
      readNumber(value.cached_input_tokens) ??
      readNumber(details.cachedInputTokens) ??
      readNumber(details.cached_input_tokens),
    cost:
      readNumber(value.cost) ??
      readNumber(value.totalCost) ??
      readNumber(value.total_cost),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
