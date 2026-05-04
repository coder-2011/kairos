import { z } from "zod";

import {
  finnhubEndpointCatalogForAccess,
  type FinnhubRestEndpointMetadata,
} from "./finnhub-catalog.js";
import { tradingConfigSchema } from "../trading/schemas.js";

export const kairosModelRoleSchema = z.enum([
  "heartbeat",
  "informationPlanner",
  "informationSynthesis",
  "debateJudge",
  "debateBull",
  "debateBear",
  "debateFinal",
]);

export const kairosReasoningEffortSchema = z.enum([
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
]);

export const heartbeatToolNameSchema = z.enum([
  "supermemory_profile",
  "supermemory_search",
  "exa_news_search",
]);

export const debateToolNameSchema = z.enum([
  "exa_search",
  "exa_research",
  "information",
  "portfolio",
]);

export const informationToolNameSchema = z.enum([
  "exa_search",
  "exa_research",
  "exa_contents",
  "finnhub_api_request",
  "finnhub_quote",
  "finnhub_company_news",
  "finnhub_stock_candles",
  "finnhub_aggregate_indicator",
  "finnhub_basic_financials",
  "finnhub_company_earnings",
  "finnhub_company_eps_estimates",
  "finnhub_company_peers",
  "finnhub_company_profile",
  "finnhub_earnings_calendar",
  "finnhub_filings",
  "finnhub_financials_reported",
  "finnhub_insider_transactions",
  "finnhub_news_sentiment",
  "finnhub_ownership",
  "finnhub_press_releases",
  "finnhub_recommendation_trends",
  "finnhub_social_sentiment",
  "finnhub_supply_chain_relationships",
  "finnhub_upgrade_downgrade",
  "supermemory_search",
]);

const confidenceSchema = z.number().min(0).max(1);

export const kairosToolPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    maxCallsPerRun: z.number().int().min(0).optional(),
    description: z.string().optional(),
    inputHint: z.string().optional(),
    requiresPremium: z.boolean().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const heartbeatToolConfigSchema = z
  .object({
    supermemory_profile: kairosToolPolicySchema.optional(),
    supermemory_search: kairosToolPolicySchema.optional(),
    exa_news_search: kairosToolPolicySchema.optional(),
  })
  .strict();

export const debateToolConfigSchema = z
  .object({
    exa_search: kairosToolPolicySchema.optional(),
    exa_research: kairosToolPolicySchema.optional(),
    information: kairosToolPolicySchema.optional(),
    portfolio: kairosToolPolicySchema.optional(),
  })
  .strict();

export const informationToolConfigSchema = z
  .object({
    exa_search: kairosToolPolicySchema.optional(),
    exa_research: kairosToolPolicySchema.optional(),
    exa_contents: kairosToolPolicySchema.optional(),
    finnhub_api_request: kairosToolPolicySchema.optional(),
    finnhub_quote: kairosToolPolicySchema.optional(),
    finnhub_company_news: kairosToolPolicySchema.optional(),
    finnhub_stock_candles: kairosToolPolicySchema.optional(),
    finnhub_aggregate_indicator: kairosToolPolicySchema.optional(),
    finnhub_basic_financials: kairosToolPolicySchema.optional(),
    finnhub_company_earnings: kairosToolPolicySchema.optional(),
    finnhub_company_eps_estimates: kairosToolPolicySchema.optional(),
    finnhub_company_peers: kairosToolPolicySchema.optional(),
    finnhub_company_profile: kairosToolPolicySchema.optional(),
    finnhub_earnings_calendar: kairosToolPolicySchema.optional(),
    finnhub_filings: kairosToolPolicySchema.optional(),
    finnhub_financials_reported: kairosToolPolicySchema.optional(),
    finnhub_insider_transactions: kairosToolPolicySchema.optional(),
    finnhub_news_sentiment: kairosToolPolicySchema.optional(),
    finnhub_ownership: kairosToolPolicySchema.optional(),
    finnhub_press_releases: kairosToolPolicySchema.optional(),
    finnhub_recommendation_trends: kairosToolPolicySchema.optional(),
    finnhub_social_sentiment: kairosToolPolicySchema.optional(),
    finnhub_supply_chain_relationships: kairosToolPolicySchema.optional(),
    finnhub_upgrade_downgrade: kairosToolPolicySchema.optional(),
    supermemory_search: kairosToolPolicySchema.optional(),
  })
  .strict();

export const kairosBranchAgentConfigSchema = z
  .object({
    assets: z.array(z.string().min(1)).optional(),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    heartbeat: z
      .object({
        intervalMinutes: z.number().positive().optional(),
        seedWindowDays: z.number().int().positive().optional(),
        maxToolSteps: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    seededData: z
      .object({
        optionalSources: z.record(z.string(), z.boolean()).optional(),
      })
      .strict()
      .optional(),
    models: z
      .partialRecord(
        kairosModelRoleSchema,
        z
          .object({
            model: z.string().min(1).optional(),
            reasoningEffort: kairosReasoningEffortSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    prompts: z
      .object({
        heartbeatSystemPrompt: z.string().optional(),
        debateJudgeSystemPrompt: z.string().optional(),
        debateBullSystemPrompt: z.string().optional(),
        debateBearSystemPrompt: z.string().optional(),
        debateFinalSystemPrompt: z.string().optional(),
      })
      .strict()
      .optional(),
    memory: z
      .object({
        supermemoryContainerTag: z.string().min(1).optional(),
        supermemoryProfileContainerTag: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    tools: z
      .object({
        heartbeat: heartbeatToolConfigSchema.optional(),
        debate: debateToolConfigSchema.optional(),
        information: informationToolConfigSchema.optional(),
        finnhubPremiumAccess: z.boolean().optional(),
      })
      .strict()
      .optional(),
    budgets: z
      .object({
        debateMaxTurns: z.number().int().positive().optional(),
        debateMaxToolCalls: z.number().int().min(0).optional(),
        debateTimeoutMinutes: z.number().positive().optional(),
        informationMaxToolCalls: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        notifyConfidence: confidenceSchema.optional(),
        buyConfidence: confidenceSchema.optional(),
        paperTradeDraftConfidence: confidenceSchema.optional(),
        escalationInfo: confidenceSchema.optional(),
        escalationWarn: confidenceSchema.optional(),
        escalationCritical: confidenceSchema.optional(),
      })
      .strict()
      .optional(),
    trading: tradingConfigSchema.optional(),
    research: z
      .object({
        exaInstruction: z.string().optional(),
        dataPacket: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type KairosConfigModelRole = z.infer<typeof kairosModelRoleSchema>;
export type KairosReasoningEffort = z.infer<typeof kairosReasoningEffortSchema>;
export type HeartbeatToolName = z.infer<typeof heartbeatToolNameSchema>;
export type DebateConfigToolName = z.infer<typeof debateToolNameSchema>;
export type InformationConfigToolName = z.infer<typeof informationToolNameSchema>;
export type KairosToolPolicy = z.infer<typeof kairosToolPolicySchema>;
export type HeartbeatToolConfig = z.infer<typeof heartbeatToolConfigSchema>;
export type DebateToolConfig = z.infer<typeof debateToolConfigSchema>;
export type InformationToolConfig = z.infer<typeof informationToolConfigSchema>;
export type KairosBranchAgentConfig = z.infer<
  typeof kairosBranchAgentConfigSchema
>;

export type HeartbeatAgentConfigSelection = {
  prompts?: {
    systemPrompt?: string;
  };
  enabledTools?: Partial<Record<HeartbeatToolName, boolean>>;
  requiredTools?: Partial<Record<HeartbeatToolName, boolean>>;
  maxToolSteps?: number;
};

export type DebateAgentConfigSelection = {
    prompts?: {
      judgeSystemPrompt?: string;
      bullSystemPrompt?: string;
      bearSystemPrompt?: string;
      finalSystemPrompt?: string;
    };
  enabledTools?: Partial<Record<DebateConfigToolName, boolean>>;
  requiredTools?: Partial<Record<DebateConfigToolName, boolean>>;
  budgets?: {
    maxTurns?: number;
    maxToolCalls?: number;
    timeoutMinutes?: number;
  };
};

export type InformationAgentConfigSelection = {
  enabledTools?: Partial<Record<InformationConfigToolName, boolean>>;
  requiredTools?: Partial<Record<InformationConfigToolName, boolean>>;
  maxToolCalls?: number;
  finnhubPremiumAccess?: boolean;
};

export type FrontendToolConfigurationCatalog = {
  finnhubPremiumAccess: boolean;
  configurableByFrontend: string[];
  notConfiguredByFrontend: string[];
  finnhubApiRequestEndpoints: FinnhubRestEndpointMetadata[];
};

export function resolveHeartbeatAgentConfig(
  config: KairosBranchAgentConfig | undefined,
): HeartbeatAgentConfigSelection {
  return {
    prompts: config?.prompts?.heartbeatSystemPrompt
      ? { systemPrompt: config.prompts.heartbeatSystemPrompt }
      : undefined,
    enabledTools: toolPoliciesToEnabledMap(config?.tools?.heartbeat),
    requiredTools: toolPoliciesToRequiredMap(config?.tools?.heartbeat),
    maxToolSteps: config?.heartbeat?.maxToolSteps,
  };
}

export function resolveDebateAgentConfig(
  config: KairosBranchAgentConfig | undefined,
): DebateAgentConfigSelection {
  return {
    prompts: {
      judgeSystemPrompt: config?.prompts?.debateJudgeSystemPrompt,
      bullSystemPrompt: config?.prompts?.debateBullSystemPrompt,
      bearSystemPrompt: config?.prompts?.debateBearSystemPrompt,
      finalSystemPrompt: config?.prompts?.debateFinalSystemPrompt,
    },
    enabledTools: toolPoliciesToEnabledMap(config?.tools?.debate),
    requiredTools: toolPoliciesToRequiredMap(config?.tools?.debate),
    budgets: {
      maxTurns: config?.budgets?.debateMaxTurns,
      maxToolCalls: config?.budgets?.debateMaxToolCalls,
      timeoutMinutes: config?.budgets?.debateTimeoutMinutes,
    },
  };
}

export function resolveInformationAgentConfig(
  config: KairosBranchAgentConfig | undefined,
): InformationAgentConfigSelection {
  const enabledTools = toolPoliciesToEnabledMap(config?.tools?.information) ?? {};
  enabledTools.supermemory_search = true;

  return {
    enabledTools,
    requiredTools: toolPoliciesToRequiredMap(config?.tools?.information),
    maxToolCalls: config?.budgets?.informationMaxToolCalls,
    finnhubPremiumAccess: config?.tools?.finnhubPremiumAccess,
  };
}

export function buildFrontendToolConfigurationCatalog(input: {
  finnhubPremiumAccess?: boolean;
} = {}): FrontendToolConfigurationCatalog {
  const finnhubPremiumAccess = input.finnhubPremiumAccess ?? false;

  return {
    finnhubPremiumAccess,
    configurableByFrontend: [
      "named information tool enablement",
      "named heartbeat/debate tool enablement",
      "Finnhub premium access",
      "max tool-call budgets",
      "branch-specific research and seeding instructions",
    ],
    notConfiguredByFrontend: [
      "Finnhub REST parameter shapes",
      "secret API keys",
      "tool implementation internals",
      "agent retry/error recovery internals",
    ],
    finnhubApiRequestEndpoints: finnhubEndpointCatalogForAccess({
      premiumAccess: finnhubPremiumAccess,
    }),
  };
}

function toolPoliciesToEnabledMap<TName extends string>(
  policies: Partial<Record<TName, KairosToolPolicy>> | undefined,
): Partial<Record<TName, boolean>> | undefined {
  if (!policies) {
    return undefined;
  }

  const enabled = Object.fromEntries(
    Object.entries(policies).flatMap(([toolName, policy]) => {
      const typedPolicy = policy as KairosToolPolicy | undefined;
      return typedPolicy?.enabled === undefined
        ? []
        : [[toolName, typedPolicy.enabled]];
    }),
  ) as Partial<Record<TName, boolean>>;

  return Object.keys(enabled).length > 0 ? enabled : undefined;
}

function toolPoliciesToRequiredMap<TName extends string>(
  policies: Partial<Record<TName, KairosToolPolicy>> | undefined,
): Partial<Record<TName, boolean>> | undefined {
  if (!policies) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries<KairosToolPolicy | undefined>(policies).map(([name, policy]) => [
      name,
      policy?.required === true,
    ]),
  ) as Partial<Record<TName, boolean>>;
}
