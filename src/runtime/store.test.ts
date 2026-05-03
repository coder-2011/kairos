import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalKairosStore,
  kairosArtifactRecordSchema,
  kairosSourceRecordSchema,
} from "./index.js";
import {
  buildFrontendToolConfigurationCatalog,
  kairosBranchAgentConfigSchema,
  resolveDebateAgentConfig,
  resolveHeartbeatAgentConfig,
  resolveInformationAgentConfig,
} from "../global/agent-config.js";

const fixedNow = new Date("2026-05-03T12:00:00.000Z");
let tempDirs: string[] = [];

async function createTempStore(): Promise<LocalKairosStore> {
  const rootDir = await mkdtemp(join(tmpdir(), "kairos-runtime-"));
  tempDirs.push(rootDir);
  let idCount = 0;

  return new LocalKairosStore({
    rootDir,
    now: () => fixedNow,
    id: () => `id-${++idCount}`,
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe("LocalKairosStore branches", () => {
  it("upserts, lists, and gets branch records", async () => {
    const store = await createTempStore();

    const created = await store.upsertBranch({
      branchId: "pltr-enterprise-deals",
      name: "PLTR enterprise deals",
      status: "enabled",
      assets: ["PLTR"],
      payload: {
        law: "Escalate on potentially material PLTR deals.",
      },
    });

    expect(created).toMatchObject({
      branchId: "pltr-enterprise-deals",
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
      assets: ["PLTR"],
    });

    const updated = await store.upsertBranch({
      branchId: "pltr-enterprise-deals",
      name: "PLTR government deals",
      status: "disabled",
      assets: ["PLTR"],
    });

    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated).toMatchObject({
      name: "PLTR government deals",
      status: "disabled",
    });
    await expect(store.getBranch("pltr-enterprise-deals")).resolves.toEqual(
      updated,
    );
    await expect(store.listBranches()).resolves.toEqual([updated]);
  });

  it("deletes branch records", async () => {
    const store = await createTempStore();

    await store.upsertBranch({
      branchId: "pltr-enterprise-deals",
      name: "PLTR enterprise deals",
      status: "enabled",
      assets: ["PLTR"],
    });

    await expect(store.deleteBranch("pltr-enterprise-deals")).resolves.toBe(true);
    await expect(store.getBranch("pltr-enterprise-deals")).resolves.toBeNull();
    await expect(store.deleteBranch("pltr-enterprise-deals")).resolves.toBe(false);
  });
});

describe("LocalKairosStore runs", () => {
  it("creates, lists, gets, and updates run records", async () => {
    const store = await createTempStore();

    const run = await store.createRun({
      kind: "heartbeat",
      status: "running",
      branchId: "pltr-enterprise-deals",
      startedAt: fixedNow.toISOString(),
    });

    expect(run).toMatchObject({
      runId: "id-1",
      kind: "heartbeat",
      status: "running",
      branchId: "pltr-enterprise-deals",
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
    });

    const updated = await store.updateRun(run.runId, {
      status: "succeeded",
      completedAt: fixedNow.toISOString(),
      summary: "No escalation.",
    });

    expect(updated).toMatchObject({
      runId: run.runId,
      kind: "heartbeat",
      status: "succeeded",
      completedAt: fixedNow.toISOString(),
      summary: "No escalation.",
    });
    await expect(store.getRun(run.runId)).resolves.toEqual(updated);
    await expect(
      store.listRuns({ branchId: "pltr-enterprise-deals" }),
    ).resolves.toEqual([updated]);
    await expect(store.listRuns({ status: "running" })).resolves.toEqual([]);
  });

  it("throws when updating an unknown run", async () => {
    const store = await createTempStore();

    await expect(
      store.updateRun("missing-run", { status: "failed" }),
    ).rejects.toThrow("Run not found: missing-run");
  });
});

describe("LocalKairosStore events", () => {
  it("appends generated and prebuilt events to run JSONL files", async () => {
    const store = await createTempStore();

    const first = await store.appendEvent({
      runId: "run-1",
      scope: "run",
      type: "heartbeat.started",
      actor: "system",
      branchId: "pltr-enterprise-deals",
      payload: {
        seedWindowDays: 30,
      },
    });
    const second = await store.appendEvent({
      eventId: "event-fixed",
      runId: "run-1",
      timestamp: fixedNow.toISOString(),
      scope: "source",
      type: "source.checked",
      actor: "heartbeat",
      branchId: "pltr-enterprise-deals",
      sourceRefs: ["https://example.com/news"],
      parentEventId: first.eventId,
      payload: {
        sourceId: "source-1",
      },
    });

    expect(first).toMatchObject({
      eventId: "id-1",
      timestamp: fixedNow.toISOString(),
      type: "heartbeat.started",
    });
    expect(second.eventId).toBe("event-fixed");

    await expect(store.listEvents({ runId: "run-1" })).resolves.toEqual([
      first,
      second,
    ]);
    await expect(
      store.listEvents({
        branchId: "pltr-enterprise-deals",
        type: "source.checked",
      }),
    ).resolves.toEqual([second]);
  });
});

describe("runtime schemas", () => {
  it("validates branch agent configuration for frontend controls", () => {
    const config = kairosBranchAgentConfigSchema.parse({
        assets: ["PLTR"],
        heartbeat: {
          intervalMinutes: 5,
          seedWindowDays: 30,
          maxToolSteps: 3,
        },
        prompts: {
          debateBullSystemPrompt: "Argue the bull case.",
        },
        tools: {
          finnhubPremiumAccess: true,
          information: {
            exa_search: { enabled: true, maxCallsPerRun: 2 },
            finnhub_filings: { enabled: false },
          },
          debate: {
            information: { enabled: true },
          },
        },
        budgets: {
          debateMaxTurns: 4,
          debateMaxToolCalls: 3,
          informationMaxToolCalls: 5,
        },
        thresholds: {
          notifyConfidence: 0.75,
          buyConfidence: 0.9,
        },
      });

    expect(config).toMatchObject({
      tools: {
        finnhubPremiumAccess: true,
      },
    });
    expect(resolveHeartbeatAgentConfig(config)).toEqual({
      prompts: undefined,
      enabledTools: undefined,
      maxToolSteps: 3,
    });
    expect(resolveDebateAgentConfig(config)).toMatchObject({
      prompts: {
        bullSystemPrompt: "Argue the bull case.",
      },
      enabledTools: {
        information: true,
      },
      budgets: {
        maxTurns: 4,
        maxToolCalls: 3,
      },
    });
    expect(resolveInformationAgentConfig(config)).toEqual({
      enabledTools: {
        exa_search: true,
        finnhub_filings: false,
      },
      maxToolCalls: 5,
      finnhubPremiumAccess: true,
    });
    expect(buildFrontendToolConfigurationCatalog({
      finnhubPremiumAccess: false,
    })).toMatchObject({
      finnhubPremiumAccess: false,
      configurableByFrontend: expect.arrayContaining([
        "named information tool enablement",
        "Finnhub premium access",
      ]),
      notConfiguredByFrontend: expect.arrayContaining([
        "Finnhub REST parameter shapes",
      ]),
      finnhubApiRequestEndpoints: expect.arrayContaining([
        expect.objectContaining({
          id: "filings",
          access: "free",
        }),
      ]),
    });
  });

  it("validates UI-facing source and artifact records", () => {
    expect(
      kairosSourceRecordSchema.parse({
        sourceId: "source-1",
        kind: "news",
        capturedAt: fixedNow.toISOString(),
        title: "PLTR announces contract",
        url: "https://example.com/news",
        provider: "exa",
      }),
    ).toMatchObject({ sourceId: "source-1", kind: "news" });

    expect(
      kairosArtifactRecordSchema.parse({
        artifactId: "artifact-1",
        runId: "run-1",
        kind: "model_output",
        createdAt: fixedNow.toISOString(),
        path: "data/runtime/artifacts/run-1/output.json",
      }),
    ).toMatchObject({ artifactId: "artifact-1", kind: "model_output" });
  });
});
