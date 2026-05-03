import {
  generateText,
  Output,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";

import { buildHeartbeatUserMessage, HEARTBEAT_SYSTEM_PROMPT } from "./prompt.js";
import {
  heartbeatOutputSchema,
  heartbeatSeedBundleSchema,
} from "./schema.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import type {
  BranchConfig,
  EscalationEvent,
  HeartbeatOutput,
  HeartbeatSeedBundle,
  HeartbeatSeedDataProviders,
  HeartbeatToolTrace,
} from "./types.js";
import { createEscalationEvent } from "./escalation.js";

type HeartbeatGenerateText = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  tools?: ToolSet;
  stopWhen: ReturnType<typeof stepCountIs>;
  output: ReturnType<typeof Output.object>;
}) => Promise<{
  output: unknown;
  steps?: Array<{
    toolCalls?: Array<{
      toolName?: string;
      toolCallId?: string;
      input?: unknown;
      args?: unknown;
    }>;
    toolResults?: Array<{
      toolName?: string;
      toolCallId?: string;
      input?: unknown;
      output?: unknown;
      result?: unknown;
      error?: unknown;
    }>;
  }>;
}>;

export type HeartbeatAgentDependencies = {
  model: LanguageModel;
  seedProviders?: HeartbeatSeedDataProviders;
  tools?: ToolSet;
  maxToolSteps?: number;
  generateText?: HeartbeatGenerateText;
  now?: () => Date;
};

export type HeartbeatRunResult = {
  output: HeartbeatOutput;
  seedBundle: HeartbeatSeedBundle;
  escalationEvent: EscalationEvent | null;
  toolTraces: HeartbeatToolTrace[];
};

export async function runHeartbeatAgent(
  branch: BranchConfig,
  deps: HeartbeatAgentDependencies,
): Promise<HeartbeatRunResult> {
  if (!branch.heartbeat.enabled) {
    throw new Error(`Heartbeat is disabled for branch ${branch.id}.`);
  }

  const seedBundle = heartbeatSeedBundleSchema.parse(
    await buildHeartbeatSeedBundle(
      branch,
      deps.seedProviders,
      deps.now?.() ?? new Date(),
    ),
  );
  const runModel = deps.generateText ?? (generateText as HeartbeatGenerateText);
  const result = await runModel({
    model: deps.model,
    system: HEARTBEAT_SYSTEM_PROMPT,
    prompt: buildHeartbeatUserMessage(seedBundle),
    tools: deps.tools,
    stopWhen: stepCountIs(deps.maxToolSteps ?? 3),
    output: Output.object({
      schema: heartbeatOutputSchema,
      name: "heartbeat_output",
      description:
        "Compact heartbeat triage decision for whether this branch should escalate.",
    }),
  });
  const parsed = heartbeatOutputSchema.parse(result.output);
  const output = {
    ...parsed,
    branch_id: seedBundle.branchId,
    timestamp: seedBundle.timestamp,
  };

  return {
    output,
    seedBundle,
    escalationEvent: createEscalationEvent(output, seedBundle),
    toolTraces: extractToolTraces(result.steps, seedBundle),
  };
}

function extractToolTraces(
  steps: Awaited<ReturnType<HeartbeatGenerateText>>["steps"],
  seedBundle: HeartbeatSeedBundle,
): HeartbeatToolTrace[] {
  return (steps ?? []).flatMap((step) => {
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];

    return results.map((result, index) => {
      const call = calls.find((candidate) => {
        return candidate.toolCallId && candidate.toolCallId === result.toolCallId;
      }) ?? calls[index];
      const error = result.error instanceof Error
        ? result.error.message
        : result.error == null
          ? undefined
          : String(result.error);

      return {
        branchId: seedBundle.branchId,
        timestamp: seedBundle.timestamp,
        toolName: result.toolName ?? call?.toolName ?? "unknown_tool",
        input: result.input ?? call?.input ?? call?.args,
        output: result.output ?? result.result,
        error,
      };
    });
  });
}
