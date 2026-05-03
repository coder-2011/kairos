import {
  runHeartbeatAgent,
  type HeartbeatAgentDependencies,
  type HeartbeatRunResult,
} from "./agent.js";
import type { BranchConfig } from "./types.js";
import { HeartbeatEscalationDeduper } from "./dedupe.js";
import { createEscalationEvent } from "./escalation.js";

export type HeartbeatOnceDependencies = HeartbeatAgentDependencies & {
  deduper?: HeartbeatEscalationDeduper;
};

export async function runHeartbeatOnce(
  branch: BranchConfig,
  deps: HeartbeatOnceDependencies,
): Promise<HeartbeatRunResult> {
  const result = await runHeartbeatAgent(branch, deps);
  const output = deps.deduper?.suppressDuplicate(result.output) ?? result.output;

  return {
    ...result,
    output,
    escalationEvent: createEscalationEvent(output, result.seedBundle),
  };
}
