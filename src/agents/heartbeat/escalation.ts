import type {
  EscalationEvent,
  HeartbeatOutput,
  HeartbeatSeedBundle,
} from "./types.js";

export function createEscalationEvent(
  heartbeatOutput: HeartbeatOutput,
  seedBundle: HeartbeatSeedBundle,
): EscalationEvent | null {
  if (heartbeatOutput.decision !== "escalate") {
    return null;
  }

  return {
    branchId: heartbeatOutput.branch_id,
    timestamp: heartbeatOutput.timestamp,
    status: "pending_big_model",
    heartbeatOutput,
    seedBundle,
  };
}
