import {
  runHeartbeatAgent,
  type HeartbeatAgentDependencies,
  type HeartbeatRunResult,
} from "./agent.js";
import {
  assertOpenRouterToolCapableModel,
  getAgentRunId,
  observeAgentError,
  observeAgentEvent,
} from "../../global/index.js";
import type { BranchConfig, HeartbeatMemoryWriter } from "./types.js";
import { createEscalationEvent } from "./escalation.js";
import { getSupermemoryProfileContainerTag } from "./memory.js";

export type HeartbeatOnceDependencies = HeartbeatAgentDependencies & {
  memoryWriter?: HeartbeatMemoryWriter;
};

export async function runHeartbeatOnce(
  branch: BranchConfig,
  deps: HeartbeatOnceDependencies,
): Promise<HeartbeatRunResult> {
  const runId = getAgentRunId("heartbeat", deps.runId);
  const runtime = {
    agent: "heartbeat" as const,
    observer: deps.observer,
    runId,
    branchId: branch.id,
    now: deps.now,
  };
  if (deps.tools && Object.keys(deps.tools).length > 0 && !deps.generateText) {
    assertOpenRouterToolCapableModel(branch.heartbeat.model);
  }

  let result: HeartbeatRunResult;
  try {
    result = await runHeartbeatAgent(branch, { ...deps, runId });
  } catch (error) {
    await observeAgentError(runtime, "run_error", error);
    throw error;
  }
  const output = result.output;
  const escalationEvent = createEscalationEvent(output, result.seedBundle);
  const containerTag = getSupermemoryProfileContainerTag(branch);

  await observeAgentEvent(
    runtime,
    "prior_memory_context_loaded",
    {
      decision: output.decision,
      priorDecisionCount: result.seedBundle.priorDecisions.length,
      summary: output.summary,
    },
    result.seedBundle.timestamp,
  );

  await deps.memoryWriter?.writeHeartbeatOutput?.({
    containerTag,
    output,
    seedBundle: result.seedBundle,
  });
  await observeAgentEvent(
    runtime,
    "heartbeat_output_persisted",
    { containerTag },
    result.seedBundle.timestamp,
  );

  if (result.toolTraces.length > 0) {
    await deps.memoryWriter?.writeToolTraces?.({
      containerTag,
      traces: result.toolTraces,
    });
    await observeAgentEvent(
      runtime,
      "tool_traces_persisted",
      {
        containerTag,
        toolTraceCount: result.toolTraces.length,
      },
      result.seedBundle.timestamp,
    );
  }

  if (escalationEvent) {
    await deps.memoryWriter?.writeEscalationEvent?.({
      containerTag,
      event: escalationEvent,
    });
    await observeAgentEvent(
      runtime,
      "escalation_persisted",
      {
        containerTag,
        decision: escalationEvent.heartbeatOutput.decision,
      },
      result.seedBundle.timestamp,
    );
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
