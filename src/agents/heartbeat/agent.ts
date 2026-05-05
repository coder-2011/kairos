import {
  generateText,
  Output,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  getAgentRunId,
  observeAgentError,
  observeAgentEvent,
  type AgentObserver,
  openRouterUsageFromAiSdkResult,
  recordProviderUsage,
} from "../../global/index.js";
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
  HeartbeatPromptSet,
  HeartbeatSeedBundle,
  HeartbeatSeedDataProviders,
  HeartbeatSeedPolicy,
  HeartbeatSeedSource,
  HeartbeatToolName,
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
  prompts?: HeartbeatPromptSet;
  enabledTools?: Partial<Record<HeartbeatToolName, boolean>>;
  seedProviders?: HeartbeatSeedDataProviders;
  tools?: ToolSet;
  maxToolSteps?: number;
  generateText?: HeartbeatGenerateText;
  now?: () => Date;
  observer?: AgentObserver;
  runId?: string;
  seedPolicy?: HeartbeatSeedPolicy;
};

export type HeartbeatRunResult = {
  output: HeartbeatOutput;
  seedBundle: HeartbeatSeedBundle;
  escalationEvent: EscalationEvent | null;
  toolTraces: HeartbeatToolTrace[];
};

const HeartbeatGraphState = Annotation.Root({
  branch: Annotation<BranchConfig>(),
  seedBundle: Annotation<HeartbeatSeedBundle | undefined>(),
  output: Annotation<HeartbeatOutput | undefined>(),
  escalationEvent: Annotation<EscalationEvent | null | undefined>(),
  toolTraces: Annotation<HeartbeatToolTrace[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});

type HeartbeatState = typeof HeartbeatGraphState.State;

export async function runHeartbeatAgent(
  branch: BranchConfig,
  deps: HeartbeatAgentDependencies,
): Promise<HeartbeatRunResult> {
  const runId = getAgentRunId("heartbeat", deps.runId);
  const runtime = {
    agent: "heartbeat" as const,
    observer: deps.observer,
    runId,
    branchId: branch.id,
    now: deps.now,
  };

  if (!branch.heartbeat.enabled) {
    const error = new Error(`Heartbeat is disabled for branch ${branch.id}.`);
    await observeAgentError(runtime, "run_error", error);
    throw error;
  }

  try {
    const graph = createHeartbeatGraph({ ...deps, runId });
    const result = await graph.invoke({ branch, toolTraces: [] });
    if (!result.seedBundle || !result.output) {
      throw new Error("Heartbeat graph completed without required output.");
    }

    return {
      output: result.output,
      seedBundle: result.seedBundle,
      escalationEvent: result.escalationEvent ?? null,
      toolTraces: result.toolTraces,
    };
  } catch (error) {
    await observeAgentError(runtime, "run_error", error);
    throw error;
  }
}

export function createHeartbeatGraph(deps: HeartbeatAgentDependencies) {
  const runId = getAgentRunId("heartbeat", deps.runId);

  const seedNode = async (
    state: HeartbeatState,
  ): Promise<{ seedBundle: HeartbeatSeedBundle }> => {
    const runtime = {
      agent: "heartbeat" as const,
      observer: deps.observer,
      runId,
      branchId: state.branch.id,
      now: deps.now,
    };
    await observeAgentEvent(runtime, "seed_start");
    const seedBundle = heartbeatSeedBundleSchema.parse(
      await buildHeartbeatSeedBundle(
        state.branch,
        deps.seedProviders,
        deps.now?.() ?? new Date(),
      ),
    );
    await observeAgentEvent(
      runtime,
      "seed_built",
      {
        assets: seedBundle.assets,
        seedWindowDays: seedBundle.seedWindowDays,
        defaultSourceKeys: Object.keys(seedBundle.defaultSources),
        priorDecisionCount: seedBundle.priorDecisions.length,
        optionalDataKeys: Object.keys(seedBundle.optionalData),
      },
      seedBundle.timestamp,
    );
    validateSeedBundleCompleteness(seedBundle, deps);

    return { seedBundle };
  };

  const modelNode = async (
    state: HeartbeatState,
  ): Promise<{
    output: HeartbeatOutput;
    escalationEvent: EscalationEvent | null;
    toolTraces: HeartbeatToolTrace[];
  }> => {
    if (!state.seedBundle) {
      throw new Error("Heartbeat seed bundle was not built before model run.");
    }

    const runtime = {
      agent: "heartbeat" as const,
      observer: deps.observer,
      runId,
      branchId: state.branch.id,
      now: deps.now,
    };
    const runModel = deps.generateText ?? (generateText as HeartbeatGenerateText);
    await observeAgentEvent(
      runtime,
      "model_start",
      {
        maxToolSteps: deps.maxToolSteps ?? 3,
        hasTools: Boolean(deps.tools && Object.keys(deps.tools).length > 0),
      },
      state.seedBundle.timestamp,
    );
    const modelStartedAt = Date.now();
    let result: Awaited<ReturnType<HeartbeatGenerateText>>;
    try {
      result = await runModel({
        model: deps.model,
        system: deps.prompts?.systemPrompt ?? HEARTBEAT_SYSTEM_PROMPT,
        prompt: buildHeartbeatUserMessage(state.seedBundle),
        tools: filterHeartbeatTools(deps.tools, deps.enabledTools),
        stopWhen: stepCountIs(deps.maxToolSteps ?? 3),
        output: Output.object({
          schema: heartbeatOutputSchema,
          name: "heartbeat_output",
          description:
            "Compact heartbeat triage decision for whether this branch should escalate.",
        }),
      });
      await recordProviderUsage(
        openRouterUsageFromAiSdkResult(result, {
          operation: "heartbeat.generateText",
          status: "succeeded",
          runId,
          branchId: state.branch.id,
          durationMs: Date.now() - modelStartedAt,
          metadata: {
            maxToolSteps: deps.maxToolSteps ?? 3,
            toolStepCount: result.steps?.length,
          },
        }),
      );
    } catch (error) {
      await recordProviderUsage({
        provider: "openrouter",
        operation: "heartbeat.generateText",
        status: "failed",
        runId,
        branchId: state.branch.id,
        durationMs: Date.now() - modelStartedAt,
        quotaUnits: 1,
        unit: "request",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
    const parsed = heartbeatOutputSchema.parse(result.output);
    const output = {
      ...parsed,
      branch_id: state.seedBundle.branchId,
      timestamp: state.seedBundle.timestamp,
    };
    const toolTraces = extractToolTraces(result.steps, state.seedBundle);

    await observeAgentEvent(
      runtime,
      "model_complete",
      {
        output,
        toolTraceCount: toolTraces.length,
      },
      state.seedBundle.timestamp,
    );

    return {
      output,
      escalationEvent: createEscalationEvent(output, state.seedBundle),
      toolTraces,
    };
  };

  return new StateGraph(HeartbeatGraphState)
    .addNode("seed_bundle", seedNode)
    .addNode("model_triage", modelNode)
    .addEdge(START, "seed_bundle")
    .addEdge("seed_bundle", "model_triage")
    .addEdge("model_triage", END)
    .compile();
}

function validateSeedBundleCompleteness(
  seedBundle: HeartbeatSeedBundle,
  deps: HeartbeatAgentDependencies,
): void {
  if (deps.generateText || deps.seedPolicy?.allowPartialSeedBundle) {
    return;
  }

  const requiredSources: HeartbeatSeedSource[] = [
    "currentPrice",
    "recentVolume",
    "tickerMovement",
    "supermemoryContext",
    "newsHeadlinesAndSummaries",
  ];
  const missingSources = requiredSources.filter((source) => {
    const value = seedBundle.defaultSources[source];
    return value === null || value === undefined;
  });

  if (missingSources.length > 0) {
    throw new Error(
      [
        "Heartbeat seed bundle is incomplete.",
        `Missing required source(s): ${missingSources.join(", ")}.`,
        "Refusing to run because fallback context would not preserve enough functionality.",
      ].join(" "),
    );
  }
}

function filterHeartbeatTools(
  tools: ToolSet | undefined,
  enabledTools: Partial<Record<HeartbeatToolName, boolean>> | undefined,
): ToolSet | undefined {
  if (!tools || !enabledTools) {
    return tools;
  }

  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) => {
      return enabledTools[toolName as HeartbeatToolName] !== false;
    }),
  ) as ToolSet;
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
