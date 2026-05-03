import { randomUUID } from "node:crypto";

import { z } from "zod";

const isoTimestampSchema = z.iso.datetime({ offset: true });

export const kairosRunKindSchema = z.enum([
  "heartbeat",
  "router",
  "research",
  "debate",
  "escalation",
  "replay",
  "manual",
]);

export const kairosRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const kairosEventScopeSchema = z.enum([
  "system",
  "branch",
  "run",
  "source",
  "artifact",
  "debate",
  "trade_intent",
]);

export const kairosSourceKindSchema = z.enum([
  "url",
  "news",
  "market_data",
  "document",
  "memory",
  "human_note",
  "agent_output",
  "other",
]);

export const kairosArtifactKindSchema = z.enum([
  "seed_bundle",
  "model_output",
  "tool_trace",
  "transcript",
  "research_report",
  "decision",
  "trade_intent",
  "other",
]);

export const kairosBranchStatusSchema = z.enum([
  "enabled",
  "disabled",
  "archived",
]);

export const kairosBranchSchema = z
  .object({
    branchId: z.string().min(1),
    name: z.string().min(1).optional(),
    lawId: z.string().min(1).optional(),
    lawVersion: z.string().min(1).optional(),
    status: kairosBranchStatusSchema.default("enabled"),
    assets: z.array(z.string().min(1)).default([]),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    summary: z.string().optional(),
    payload: z.unknown().optional(),
  })
  .strict();

export const kairosSourceRecordSchema = z
  .object({
    sourceId: z.string().min(1),
    kind: kairosSourceKindSchema,
    capturedAt: isoTimestampSchema,
    title: z.string().optional(),
    url: z.url().optional(),
    provider: z.string().min(1).optional(),
    publishedAt: isoTimestampSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const kairosArtifactRecordSchema = z
  .object({
    artifactId: z.string().min(1),
    runId: z.string().min(1),
    kind: kairosArtifactKindSchema,
    createdAt: isoTimestampSchema,
    path: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    summary: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const kairosRunSchema = z
  .object({
    runId: z.string().min(1),
    kind: kairosRunKindSchema,
    status: kairosRunStatusSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    startedAt: isoTimestampSchema.optional(),
    completedAt: isoTimestampSchema.optional(),
    branchId: z.string().min(1).optional(),
    debateId: z.string().min(1).optional(),
    escalationId: z.string().min(1).optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const kairosEventSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    timestamp: isoTimestampSchema,
    scope: kairosEventScopeSchema,
    type: z.string().min(1),
    actor: z.string().min(1),
    payload: z.unknown(),
    branchId: z.string().min(1).optional(),
    debateId: z.string().min(1).optional(),
    sourceRefs: z.array(z.string().min(1)).optional(),
    parentEventId: z.string().min(1).optional(),
  })
  .strict();

export const createKairosEventInputSchema = kairosEventSchema.omit({
  eventId: true,
  timestamp: true,
});

export const createKairosRunInputSchema = kairosRunSchema
  .omit({
    runId: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    runId: z.string().min(1).optional(),
  });

export const upsertKairosBranchInputSchema = kairosBranchSchema
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    createdAt: isoTimestampSchema.optional(),
    updatedAt: isoTimestampSchema.optional(),
  });

export const updateKairosRunInputSchema = kairosRunSchema
  .omit({
    runId: true,
    kind: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export type KairosRunKind = z.infer<typeof kairosRunKindSchema>;
export type KairosRunStatus = z.infer<typeof kairosRunStatusSchema>;
export type KairosEventScope = z.infer<typeof kairosEventScopeSchema>;
export type KairosSourceKind = z.infer<typeof kairosSourceKindSchema>;
export type KairosArtifactKind = z.infer<typeof kairosArtifactKindSchema>;
export type KairosBranchStatus = z.infer<typeof kairosBranchStatusSchema>;
export type KairosBranch = z.infer<typeof kairosBranchSchema>;
export type KairosSourceRecord = z.infer<typeof kairosSourceRecordSchema>;
export type KairosArtifactRecord = z.infer<typeof kairosArtifactRecordSchema>;
export type KairosRun = z.infer<typeof kairosRunSchema>;
export type KairosEvent = z.infer<typeof kairosEventSchema>;
export type CreateKairosEventInput = z.infer<
  typeof createKairosEventInputSchema
>;
export type CreateKairosRunInput = z.infer<typeof createKairosRunInputSchema>;
export type UpsertKairosBranchInput = z.infer<
  typeof upsertKairosBranchInputSchema
>;
export type UpdateKairosRunInput = z.infer<typeof updateKairosRunInputSchema>;

export type KairosEventFactoryOptions = {
  id?: () => string;
  now?: () => Date;
};

export function createKairosEvent(
  input: CreateKairosEventInput,
  options: KairosEventFactoryOptions = {},
): KairosEvent {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return kairosEventSchema.parse({
    ...input,
    eventId: id(),
    timestamp: now().toISOString(),
  });
}
