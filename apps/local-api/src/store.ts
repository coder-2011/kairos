export type JsonRecord = Record<string, unknown>;

export type BranchRecord = {
  id: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  law?: JsonRecord;
  config?: JsonRecord;
  metadata?: JsonRecord;
};

export type RunKind = "heartbeat" | "debate";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type RunRecord = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  branchId?: string;
  createdAt: string;
  updatedAt: string;
  dryRun: boolean;
  input: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
};

export type RunEventRecord = {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  payload: JsonRecord;
};

export type CreateBranchInput = {
  id?: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  law?: JsonRecord;
  config?: JsonRecord;
  metadata?: JsonRecord;
};

export type UpdateBranchInput = Partial<Omit<CreateBranchInput, "id">>;

export type CreateRunInput = {
  id?: string;
  kind: RunKind;
  status?: RunStatus;
  branchId?: string;
  dryRun?: boolean;
  input?: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
};

export type AppendRunEventInput = {
  id?: string;
  type: string;
  timestamp?: string;
  payload?: JsonRecord;
};

export type RunEventSubscriber = (event: RunEventRecord) => void;

export type KairosLocalStore = {
  listBranches(): Promise<BranchRecord[]>;
  getBranch(id: string): Promise<BranchRecord | undefined>;
  createBranch(input: CreateBranchInput): Promise<BranchRecord>;
  updateBranch(id: string, input: UpdateBranchInput): Promise<BranchRecord | undefined>;
  deleteBranch(id: string): Promise<boolean>;
  listRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | undefined>;
  createRun(input: CreateRunInput): Promise<RunRecord>;
  updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>): Promise<RunRecord | undefined>;
  listRunEvents(runId: string): Promise<RunEventRecord[]>;
  appendRunEvent(runId: string, input: AppendRunEventInput): Promise<RunEventRecord>;
  subscribeToRunEvents?(runId: string, subscriber: RunEventSubscriber): () => void;
};

export class MemoryKairosStore implements KairosLocalStore {
  private branches = new Map<string, BranchRecord>();
  private runs = new Map<string, RunRecord>();
  private events = new Map<string, RunEventRecord[]>();
  private subscribers = new Map<string, Set<RunEventSubscriber>>();
  private sequence = 0;

  async listBranches(): Promise<BranchRecord[]> {
    return sortByCreatedAt([...this.branches.values()]);
  }

  async getBranch(id: string): Promise<BranchRecord | undefined> {
    return this.branches.get(id);
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? this.nextId("branch");
    const branch: BranchRecord = {
      id,
      lawId: input.lawId,
      name: input.name,
      description: input.description,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      law: input.law,
      config: input.config,
      metadata: input.metadata,
    };
    this.branches.set(id, branch);
    return branch;
  }

  async updateBranch(id: string, input: UpdateBranchInput): Promise<BranchRecord | undefined> {
    const current = this.branches.get(id);
    if (!current) return undefined;

    const branch: BranchRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(id, branch);
    return branch;
  }

  async deleteBranch(id: string): Promise<boolean> {
    return this.branches.delete(id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return sortByCreatedAt([...this.runs.values()]);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? this.nextId(input.kind);
    const run: RunRecord = {
      id,
      kind: input.kind,
      status: input.status ?? "pending",
      branchId: input.branchId,
      createdAt: now,
      updatedAt: now,
      dryRun: input.dryRun ?? true,
      input: input.input ?? {},
      output: input.output,
      metadata: input.metadata,
    };
    this.runs.set(id, run);
    return run;
  }

  async updateRun(id: string, input: Partial<Pick<RunRecord, "status" | "output" | "metadata">>): Promise<RunRecord | undefined> {
    const current = this.runs.get(id);
    if (!current) return undefined;

    const run: RunRecord = {
      ...current,
      ...definedFields(input),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(id, run);
    return run;
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return [...(this.events.get(runId) ?? [])];
  }

  async appendRunEvent(runId: string, input: AppendRunEventInput): Promise<RunEventRecord> {
    const event: RunEventRecord = {
      id: input.id ?? this.nextId("event"),
      runId,
      type: input.type,
      timestamp: input.timestamp ?? new Date().toISOString(),
      payload: input.payload ?? {},
    };
    const events = this.events.get(runId) ?? [];
    events.push(event);
    this.events.set(runId, events);

    for (const subscriber of this.subscribers.get(runId) ?? []) {
      subscriber(event);
    }
    return event;
  }

  subscribeToRunEvents(runId: string, subscriber: RunEventSubscriber): () => void {
    const subscribers = this.subscribers.get(runId) ?? new Set<RunEventSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(runId, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
  }
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function sortByCreatedAt<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
