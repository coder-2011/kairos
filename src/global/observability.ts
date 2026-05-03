import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AgentName = "heartbeat" | "information" | "debate";

export type AgentObservation = {
  agent: AgentName;
  type: string;
  timestamp: string;
  runId?: string;
  branchId?: string;
  payload?: unknown;
};

export type AgentObserver = {
  event: (event: AgentObservation) => void | Promise<void>;
};

export function observe(
  observer: AgentObserver | undefined,
  event: Omit<AgentObservation, "timestamp"> & { timestamp?: string },
): Promise<void> {
  if (!observer) {
    return Promise.resolve();
  }

  return Promise.resolve(
    observer.event({
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
      payload: summarizePayload(event.payload),
    }),
  );
}

export function createJsonlObserver(path: string): AgentObserver {
  return {
    event: (event) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(event)}\n`);
    },
  };
}

function summarizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      preview: value.slice(0, 5).map(summarizePayload),
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
    entries.map(([key, entry]) => [key, summarizePayload(entry)]),
  );
}
