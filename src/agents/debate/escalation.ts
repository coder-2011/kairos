import type { EscalationEvent } from "../heartbeat/types.js";
import type { DebateStartInput } from "./types.js";

export function createDebateStartInputFromEscalation(
  event: EscalationEvent,
): DebateStartInput {
  return {
    summary: [
      `Heartbeat escalated branch ${event.branchId} at ${event.timestamp}.`,
      event.heartbeatOutput.summary,
    ].join("\n"),
    basicFinancials: {
      branchId: event.branchId,
      timestamp: event.timestamp,
      law: event.seedBundle.law,
      assets: event.seedBundle.assets,
      seedWindowDays: event.seedBundle.seedWindowDays,
      defaultSources: event.seedBundle.defaultSources,
      optionalData: event.seedBundle.optionalData,
      heartbeatDecision: event.heartbeatOutput.decision,
    },
  };
}
