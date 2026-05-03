import {
  createOpenRouterChatModel,
  createOpenRouterModel,
  type OpenRouterAiSdkChatModel,
  type OpenRouterModelConfig,
} from "./openrouter.js";
import type { KairosBranchAgentConfig } from "./agent-config.js";

export type OpenRouterReasoningEffort =
  | "xhigh"
  | "high"
  | "medium"
  | "low"
  | "minimal"
  | "none";

export type KairosModelRole =
  | "heartbeat"
  | "informationPlanner"
  | "informationSynthesis"
  | "debateJudge"
  | "debateBull"
  | "debateBear"
  | "debateFinal";

export type KairosRoleModelConfig = {
  model: string;
  reasoning?: {
    effort: OpenRouterReasoningEffort;
  };
};

export type KairosRoleModelOverrides = Partial<
  Record<
    KairosModelRole,
    {
      model?: string;
      reasoningEffort?: OpenRouterReasoningEffort;
    }
  >
>;

export type OpenRouterRoleModelFactoryConfig = Omit<
  OpenRouterModelConfig,
  "model" | "reasoning"
> & {
  env?: NodeJS.ProcessEnv;
  modelOverrides?: KairosRoleModelOverrides;
};

export const DEFAULT_KAIROS_MODEL_CONFIGS: Record<
  KairosModelRole,
  KairosRoleModelConfig
> = {
  heartbeat: {
    model: "google/gemma-4-31b-it",
  },
  informationPlanner: {
    model: "google/gemma-4-31b-it",
  },
  informationSynthesis: {
    model: "google/gemma-4-31b-it",
  },
  debateJudge: {
    model: "anthropic/claude-opus-4.7",
    reasoning: { effort: "high" },
  },
  debateBull: {
    model: "openai/gpt-5.5",
    reasoning: { effort: "xhigh" },
  },
  debateBear: {
    model: "google/gemini-3.1-pro-preview",
    reasoning: { effort: "high" },
  },
  debateFinal: {
    model: "anthropic/claude-opus-4.7",
    reasoning: { effort: "high" },
  },
};

const MODEL_ENV_BY_ROLE: Record<KairosModelRole, string> = {
  heartbeat: "OPENROUTER_HEARTBEAT_MODEL",
  informationPlanner: "OPENROUTER_INFORMATION_PLANNER_MODEL",
  informationSynthesis: "OPENROUTER_INFORMATION_SYNTHESIS_MODEL",
  debateJudge: "OPENROUTER_DEBATE_JUDGE_MODEL",
  debateBull: "OPENROUTER_DEBATE_BULL_MODEL",
  debateBear: "OPENROUTER_DEBATE_BEAR_MODEL",
  debateFinal: "OPENROUTER_DEBATE_FINAL_MODEL",
};

const REASONING_ENV_BY_ROLE: Record<KairosModelRole, string> = {
  heartbeat: "OPENROUTER_HEARTBEAT_REASONING_EFFORT",
  informationPlanner: "OPENROUTER_INFORMATION_PLANNER_REASONING_EFFORT",
  informationSynthesis: "OPENROUTER_INFORMATION_SYNTHESIS_REASONING_EFFORT",
  debateJudge: "OPENROUTER_DEBATE_JUDGE_REASONING_EFFORT",
  debateBull: "OPENROUTER_DEBATE_BULL_REASONING_EFFORT",
  debateBear: "OPENROUTER_DEBATE_BEAR_REASONING_EFFORT",
  debateFinal: "OPENROUTER_DEBATE_FINAL_REASONING_EFFORT",
};

const VALID_REASONING_EFFORTS = new Set<OpenRouterReasoningEffort>([
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
]);

export function resolveKairosModelConfig(
  role: KairosModelRole,
  env: NodeJS.ProcessEnv = process.env,
  overrides: KairosRoleModelOverrides = {},
): KairosRoleModelConfig {
  const defaults = DEFAULT_KAIROS_MODEL_CONFIGS[role];
  const model =
    overrides[role]?.model ??
    env[MODEL_ENV_BY_ROLE[role]] ??
    legacyModelOverride(role, env) ??
    defaults.model;
  const reasoningEffort = parseReasoningEffort(
    overrides[role]?.reasoningEffort ?? env[REASONING_ENV_BY_ROLE[role]],
  );

  return {
    model,
    reasoning:
      reasoningEffort !== undefined
        ? { effort: reasoningEffort }
        : defaults.reasoning,
  };
}

export function branchConfigToModelOverrides(
  config: KairosBranchAgentConfig | undefined,
): KairosRoleModelOverrides {
  if (!config?.models) return {};

  return Object.fromEntries(
    Object.entries(config.models).map(([role, roleConfig]) => [
      role,
      {
        model: roleConfig?.model,
        reasoningEffort: roleConfig?.reasoningEffort,
      },
    ]),
  ) as KairosRoleModelOverrides;
}

export function createOpenRouterChatModelForRole(
  role: KairosModelRole,
  config: OpenRouterRoleModelFactoryConfig = {},
) {
  const { env, modelOverrides, ...openRouterConfig } = config;
  return createOpenRouterChatModel({
    ...openRouterConfig,
    ...resolveKairosModelConfig(role, env, modelOverrides),
  });
}

export function createOpenRouterAiSdkModelForRole(
  role: KairosModelRole,
  config: OpenRouterRoleModelFactoryConfig = {},
): OpenRouterAiSdkChatModel {
  const { env, modelOverrides, ...openRouterConfig } = config;
  return createOpenRouterModel({
    ...openRouterConfig,
    ...resolveKairosModelConfig(role, env, modelOverrides),
  });
}

function legacyModelOverride(
  role: KairosModelRole,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (role === "heartbeat") {
    return env.OPENROUTER_HEARTBEAT_MODEL ?? env.KAIROS_LIVE_OPENROUTER_MODEL;
  }

  return env.KAIROS_LIVE_OPENROUTER_MODEL;
}

function parseReasoningEffort(
  value: string | undefined,
): OpenRouterReasoningEffort | undefined {
  return value && VALID_REASONING_EFFORTS.has(value as OpenRouterReasoningEffort)
    ? (value as OpenRouterReasoningEffort)
    : undefined;
}
