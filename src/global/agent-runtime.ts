import {
  observe,
  type AgentName,
  type AgentObserver,
} from "./observability.js";

export type AgentRuntimeContext = {
  agent: AgentName;
  observer?: AgentObserver;
  runId: string;
  branchId?: string;
  now?: () => Date;
};

export function createAgentRunId(agent: AgentName): string {
  return `${agent}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function getAgentRunId(agent: AgentName, runId?: string): string {
  return runId ?? createAgentRunId(agent);
}

export function observeAgentEvent(
  ctx: AgentRuntimeContext,
  type: string,
  payload?: unknown,
  timestamp?: string,
): Promise<void> {
  return observe(ctx.observer, {
    agent: ctx.agent,
    type,
    runId: ctx.runId,
    branchId: ctx.branchId,
    timestamp: timestamp ?? (ctx.now?.() ?? new Date()).toISOString(),
    payload: summarizeObservationPayload(payload),
  });
}

export function observeAgentError(
  ctx: AgentRuntimeContext,
  type: string,
  error: unknown,
  payload?: Record<string, unknown>,
): Promise<void> {
  return observeAgentEvent(ctx, type, {
    ...payload,
    error: serializeError(error),
  });
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

export function summarizeObservationPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      preview: value.slice(0, 5).map(summarizeObservationPayload),
    };
  }

  if (typeof value === "string") {
    return value.length > 2_000
      ? {
          kind: "string",
          length: value.length,
          preview: value.slice(0, 2_000),
        }
      : value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value);
  if (entries.length > 50) {
    return {
      kind: "object",
      keyCount: entries.length,
      keys: entries.slice(0, 50).map(([key]) => key),
    };
  }

  return Object.fromEntries(
    entries.map(([key, entry]) => [key, summarizeObservationPayload(entry)]),
  );
}
