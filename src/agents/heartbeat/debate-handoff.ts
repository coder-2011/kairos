import {
  runDebateAgent,
  type DebateGraphDependencies,
  type DebateRunConfig,
  type DebateRunResult,
  type DebateStartInput,
} from "../debate/index.js";
import type { HeartbeatRunResult } from "./agent.js";
import { runHeartbeatOnce } from "./heartbeat.js";
import type { EscalationEvent } from "./types.js";

type HeartbeatBranch = Parameters<typeof runHeartbeatOnce>[0];
type HeartbeatRunDependencies = Parameters<typeof runHeartbeatOnce>[1];

export type HeartbeatDebateOptions = {
  debateId?: string;
  budgets?: DebateRunConfig["budgets"];
  humanInterjections?: DebateRunConfig["humanInterjections"];
  portfolioContext?: DebateStartInput["portfolioContext"];
};

export type HeartbeatDebateRunResult = {
  heartbeat: HeartbeatRunResult;
  debate: DebateRunResult | null;
};

export function createDebateConfigFromEscalation(
  event: EscalationEvent,
  options: HeartbeatDebateOptions = {},
): DebateRunConfig {
  const config: DebateRunConfig = {
    debateId: options.debateId ?? createDebateId(event),
    startInput: createDebateStartInputFromEscalation(event, options),
  };

  if (options.humanInterjections) {
    config.humanInterjections = options.humanInterjections;
  }

  if (options.budgets) {
    config.budgets = options.budgets;
  }

  return config;
}

export function createDebateStartInputFromEscalation(
  event: EscalationEvent,
  options: Pick<HeartbeatDebateOptions, "portfolioContext"> = {},
): DebateStartInput {
  return {
    summary: [
      `Heartbeat escalated branch ${event.branchId}.`,
      `Heartbeat summary: ${event.heartbeatOutput.summary}`,
      `Assets: ${event.seedBundle.assets.join(", ")}`,
      `Law: ${event.seedBundle.law}`,
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
      heartbeatSummary: event.heartbeatOutput.summary,
    },
    ...(options.portfolioContext
      ? { portfolioContext: options.portfolioContext }
      : {}),
  };
}

export async function runDebateForEscalation(
  event: EscalationEvent,
  deps: DebateGraphDependencies = {},
  options: HeartbeatDebateOptions = {},
): Promise<DebateRunResult> {
  return runDebateAgent(createDebateConfigFromEscalation(event, options), deps);
}

export async function runDebateForHeartbeatResult(
  result: HeartbeatRunResult,
  deps: DebateGraphDependencies = {},
  options: HeartbeatDebateOptions = {},
): Promise<DebateRunResult | null> {
  if (!result.escalationEvent) {
    return null;
  }

  return runDebateForEscalation(result.escalationEvent, deps, options);
}

export async function runHeartbeatThenDebate(
  branch: HeartbeatBranch,
  heartbeatDeps: HeartbeatRunDependencies,
  debateDeps: DebateGraphDependencies = {},
  options: HeartbeatDebateOptions = {},
): Promise<HeartbeatDebateRunResult> {
  const heartbeat = await runHeartbeatOnce(branch, heartbeatDeps);
  const debate = await runDebateForHeartbeatResult(heartbeat, debateDeps, options);
  return { heartbeat, debate };
}

function createDebateId(event: EscalationEvent): string {
  return safeId(`debate:${event.branchId}:${event.timestamp}`);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, "_");
}
