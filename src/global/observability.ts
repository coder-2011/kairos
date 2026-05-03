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
