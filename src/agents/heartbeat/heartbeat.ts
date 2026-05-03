import {
  runHeartbeatAgent,
  type HeartbeatAgentDependencies,
  type HeartbeatRunResult,
} from "./agent.js";
import type { BranchConfig, HeartbeatMemoryWriter } from "./types.js";
import { HeartbeatEscalationDeduper } from "./dedupe.js";
import { createEscalationEvent } from "./escalation.js";
import { getSupermemoryContainerTag } from "./memory.js";

export type HeartbeatOnceDependencies = HeartbeatAgentDependencies & {
  deduper?: HeartbeatEscalationDeduper;
  memoryWriter?: HeartbeatMemoryWriter;
};

export async function runHeartbeatOnce(
  branch: BranchConfig,
  deps: HeartbeatOnceDependencies,
): Promise<HeartbeatRunResult> {
  const result = await runHeartbeatAgent(branch, deps);
  const output = deps.deduper?.suppressDuplicate(result.output) ?? result.output;
  const escalationEvent = createEscalationEvent(output, result.seedBundle);
  const containerTag = getSupermemoryContainerTag(branch);

  await deps.memoryWriter?.writeHeartbeatOutput?.({
    containerTag,
    output,
    seedBundle: result.seedBundle,
  });

  if (result.toolTraces.length > 0) {
    await deps.memoryWriter?.writeToolTraces?.({
      containerTag,
      traces: result.toolTraces,
    });
  }

  if (escalationEvent) {
    await deps.memoryWriter?.writeEscalationEvent?.({
      containerTag,
      event: escalationEvent,
    });
  }

  return {
    ...result,
    output,
    escalationEvent,
  };
}

export type HeartbeatScheduler = {
  runNow: () => Promise<HeartbeatRunResult[]>;
  stop: () => void;
};

export type HeartbeatSchedulerDependencies = HeartbeatOnceDependencies & {
  onResult?: (result: HeartbeatRunResult, branch: BranchConfig) => void;
  onError?: (error: unknown, branch: BranchConfig) => void;
};

export function startHeartbeatScheduler(
  branches: BranchConfig | BranchConfig[],
  deps: HeartbeatSchedulerDependencies,
): HeartbeatScheduler {
  const branchList = Array.isArray(branches) ? branches : [branches];
  let stopped = false;

  const runBranch = async (branch: BranchConfig): Promise<HeartbeatRunResult> => {
    const result = await runHeartbeatOnce(branch, deps);
    deps.onResult?.(result, branch);
    return result;
  };

  const runSafely = (branch: BranchConfig): void => {
    void runBranch(branch).catch((error: unknown) => {
      deps.onError?.(error, branch);
    });
  };

  const timers = branchList.map((branch) =>
    setInterval(
      () => {
        if (!stopped) {
          runSafely(branch);
        }
      },
      Math.max(1, branch.heartbeat.intervalMinutes) * 60_000,
    ),
  );

  return {
    runNow: () => Promise.all(branchList.map(runBranch)),
    stop: () => {
      stopped = true;
      timers.forEach(clearInterval);
    },
  };
}
