import {
  LocalKairosStore,
  type KairosBranch,
  type KairosEvent,
  type KairosRun,
} from "../../../src/runtime/index.js";
import type {
  AppendRunEventInput,
  BranchRecord,
  CreateBranchInput,
  CreateRunInput,
  KairosLocalStore,
  RunEventRecord,
  RunRecord,
  UpdateBranchInput,
} from "./store.js";

export async function createRuntimeStore(
  options: { dataDir?: string } = {},
): Promise<KairosLocalStore> {
  return new RuntimeStoreAdapter(
    new LocalKairosStore({ rootDir: options.dataDir }),
  );
}

class RuntimeStoreAdapter implements KairosLocalStore {
  constructor(private readonly store: LocalKairosStore) {}

  async listBranches(): Promise<BranchRecord[]> {
    return (await this.store.listBranches()).map(toBranchRecord);
  }

  async getBranch(id: string): Promise<BranchRecord | undefined> {
    return toOptional(await this.store.getBranch(id), toBranchRecord);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const branch = await this.store.upsertBranch({
      branchId: input.id ?? slugId(input.name),
      lawId: input.lawId,
      name: input.name,
      status: input.enabled === false ? "disabled" : "enabled",
      summary: input.description,
      assets: getAssets(input),
      payload: {
        law: input.law,
        config: input.config,
        metadata: input.metadata,
      },
    });
    return toBranchRecord(branch);
  }

  async updateBranch(
    id: string,
    input: UpdateBranchInput,
  ): Promise<BranchRecord | undefined> {
    const current = await this.store.getBranch(id);
    if (!current) {
      return undefined;
    }

    const currentPayload = readBranchPayload(current);
    const branch = await this.store.upsertBranch({
      branchId: id,
      lawId: input.lawId ?? current.lawId,
      name: input.name ?? current.name ?? id,
      status:
        input.enabled === undefined
          ? current.status
          : input.enabled
            ? "enabled"
            : "disabled",
      summary: input.description ?? current.summary,
      assets: input.config ? getAssets(input) : current.assets,
      payload: {
        law: input.law ?? currentPayload.law,
        config: input.config ?? currentPayload.config,
        metadata: input.metadata ?? currentPayload.metadata,
      },
    });
    return toBranchRecord(branch);
  }

  async deleteBranch(id: string): Promise<boolean> {
    return this.store.deleteBranch(id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return (await this.store.listRuns()).map(toRunRecord);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return toOptional(await this.store.getRun(id), toRunRecord);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const run = await this.store.createRun({
      runId: input.id,
      kind: input.kind,
      status: input.status ?? "pending",
      branchId: input.branchId,
      dryRun: input.dryRun ?? true,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
      startedAt:
        input.status === "running" ? new Date().toISOString() : undefined,
    });
    return toRunRecord(run);
  }

  async updateRun(
    id: string,
    input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>,
  ): Promise<RunRecord | undefined> {
    const run = await this.store.updateRun(id, {
      status: input.status,
      output: input.output,
      metadata: input.metadata,
      completedAt:
        input.status === "succeeded" || input.status === "failed"
          ? new Date().toISOString()
          : undefined,
    });
    return toRunRecord(run);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return (await this.store.listEvents({ runId })).map(toRunEventRecord);
  }

  async appendRunEvent(
    runId: string,
    input: AppendRunEventInput,
  ): Promise<RunEventRecord> {
    const run = await this.store.getRun(runId);
    const eventInput = {
      runId,
      scope: "run",
      type: input.type,
      actor: "local-api",
      branchId: run?.branchId,
      debateId: run?.debateId,
      payload: input.payload ?? {},
    } as const;
    const event = await this.store.appendEvent({
      ...eventInput,
      ...(input.id ? { eventId: input.id } : {}),
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    });
    return toRunEventRecord(event);
  }
}

function toBranchRecord(branch: KairosBranch): BranchRecord {
  const payload = readBranchPayload(branch);
  return {
    id: branch.branchId,
    lawId: branch.lawId,
    name: branch.name ?? branch.branchId,
    description: branch.summary,
    enabled: branch.status === "enabled",
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    law: payload.law,
    config: payload.config,
    metadata: payload.metadata,
  };
}

function toRunRecord(run: KairosRun): RunRecord {
  return {
    id: run.runId,
    kind: run.kind === "debate" ? "debate" : "heartbeat",
    status: run.status,
    branchId: run.branchId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    dryRun: run.dryRun ?? true,
    input: isJsonRecord(run.input) ? run.input : {},
    output: isJsonRecord(run.output) ? run.output : undefined,
    metadata: isJsonRecord(run.metadata) ? run.metadata : undefined,
  };
}

function toRunEventRecord(event: KairosEvent): RunEventRecord {
  return {
    id: event.eventId,
    runId: event.runId,
    type: event.type,
    timestamp: event.timestamp,
    payload: isJsonRecord(event.payload) ? event.payload : { value: event.payload },
  };
}

function toOptional<T, U>(value: T | null, map: (value: T) => U): U | undefined {
  return value === null ? undefined : map(value);
}

function readBranchPayload(branch: KairosBranch): {
  law?: Record<string, unknown>;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  if (!isJsonRecord(branch.payload)) {
    return {};
  }

  return {
    law: isJsonRecord(branch.payload.law) ? branch.payload.law : undefined,
    config: isJsonRecord(branch.payload.config)
      ? branch.payload.config
      : undefined,
    metadata: isJsonRecord(branch.payload.metadata)
      ? branch.payload.metadata
      : undefined,
  };
}

function getAssets(input: Pick<CreateBranchInput, "config">): string[] {
  const assets = input.config?.assets;
  return Array.isArray(assets)
    ? assets.filter((asset): asset is string => typeof asset === "string")
    : [];
}

function slugId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "branch";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
