import { z } from "zod";

export const heartbeatOutputSchema = z
  .object({
    branch_id: z.string(),
    timestamp: z.string(),
    decision: z.enum(["no_escalation", "escalate"]),
    summary: z.string().min(1),
  })
  .strict();

export const branchConfigSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    law: z.string(),
    assets: z.array(z.string()),
    heartbeat: z
      .object({
        enabled: z.boolean(),
        intervalMinutes: z.number().positive(),
        seedWindowDays: z.number().int().positive().default(30),
        model: z.string(),
        maxSearchCalls: z.number().int().nonnegative().optional(),
        maxMemoryQueries: z.number().int().nonnegative().optional(),
      })
      .strict(),
    seededData: z
      .object({
        generalMarketNewsWindowDays: z.number().int().positive().default(20),
        optionalSources: z.record(z.string(), z.boolean()).optional(),
      })
      .strict()
      .optional(),
    memory: z
      .object({
        supermemoryContainerTag: z.string().optional(),
        supermemoryProfileContainerTag: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const heartbeatSeedBundleSchema = z
  .object({
    branchId: z.string(),
    timestamp: z.string(),
    law: z.string(),
    assets: z.array(z.string()),
    seedWindowDays: z.number().int().positive(),
    generalMarketNewsWindowDays: z.number().int().positive(),
    supermemoryContainerTag: z.string(),
    supermemoryProfileContainerTag: z.string(),
    defaultSources: z.object({
      currentPrice: z.unknown().nullable(),
      recentVolume: z.unknown().nullable(),
      tickerMovement: z.unknown().nullable(),
      supermemoryContext: z.unknown().nullable(),
      deepResearchMemoryContext: z.unknown().nullable(),
      newsHeadlinesAndSummaries: z.unknown().nullable(),
      generalMarketNews: z.unknown().nullable(),
    }),
    priorDecisions: z.array(
      z
        .object({
          id: z.string().optional(),
          memory: z.string(),
          similarity: z.number().optional(),
          updatedAt: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    optionalData: z.record(z.string(), z.unknown()),
  })
  .strict();

export type HeartbeatOutputFromSchema = z.infer<typeof heartbeatOutputSchema>;
export type BranchConfigFromSchema = z.infer<typeof branchConfigSchema>;
export type HeartbeatSeedBundleFromSchema = z.infer<
  typeof heartbeatSeedBundleSchema
>;
