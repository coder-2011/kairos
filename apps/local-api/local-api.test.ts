import { describe, expect, it } from "vitest";
import { createLocalApiHandler, MemoryKairosStore, type LocalApiContext } from "./src/server.js";

const baseUrl = "http://kairos.local";

describe("local API handler", () => {
  it("responds to health checks", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "kairos-local-api" });
  });

  it("supports branch create, list, get, update, and delete", async () => {
    const { requestJson } = makeClient();

    const created = await requestJson("POST", "/branches", {
      id: "branch_pltr_deals",
      lawId: "law_pltr_deals",
      name: "PLTR deals",
      law: { watchFor: "credible new deals" },
    });
    expect(created.status).toBe(201);
    expect(created.body.branch).toMatchObject({ id: "branch_pltr_deals", enabled: true });

    const listed = await requestJson("GET", "/branches");
    expect(listed.body.branches).toHaveLength(1);

    const fetched = await requestJson("GET", "/branches/branch_pltr_deals");
    expect(fetched.body.branch.name).toBe("PLTR deals");

    const updated = await requestJson("PATCH", "/branches/branch_pltr_deals", { enabled: false });
    expect(updated.body.branch.enabled).toBe(false);

    const deleted = await requestJson("DELETE", "/branches/branch_pltr_deals");
    expect(deleted.status).toBe(204);

    const missing = await requestJson("GET", "/branches/branch_pltr_deals");
    expect(missing.status).toBe(404);
  });

  it("triggers deterministic dry-run heartbeat runs and exposes run events", async () => {
    const { requestJson } = makeClient();
    await requestJson("POST", "/branches", { id: "branch_1", name: "Branch 1" });

    const created = await requestJson("POST", "/branches/branch_1/heartbeat-runs", {
      input: { ticker: "PLTR" },
    });

    expect(created.status).toBe(201);
    expect(created.body.run).toMatchObject({
      kind: "heartbeat",
      status: "completed",
      branchId: "branch_1",
      dryRun: true,
    });
    expect(created.body.run.output.decision).toBe("monitor");

    const listedRuns = await requestJson("GET", "/runs");
    expect(listedRuns.body.runs).toHaveLength(1);

    const fetchedRun = await requestJson("GET", `/runs/${created.body.run.id}`);
    expect(fetchedRun.body.run.id).toBe(created.body.run.id);

    const events = await requestJson("GET", `/runs/${created.body.run.id}/events`);
    expect(events.body.events.map((event: { type: string }) => event.type)).toEqual([
      "run.started",
      "heartbeat.seeded",
      "heartbeat.decision",
      "run.completed",
    ]);
  });

  it("creates deterministic debate runs from escalation-like payloads", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/debates", {
      escalation: {
        branchId: "branch_pltr_deals",
        summary: "Potentially material contract news.",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.run).toMatchObject({
      kind: "debate",
      status: "completed",
      branchId: "branch_pltr_deals",
      dryRun: true,
    });
    expect(response.body.run.output.decision).toBe("needs_review");
  });

  it("appends human interjections to run events", async () => {
    const { requestJson } = makeClient();
    const debate = await requestJson("POST", "/debates", {
      escalation: { branchId: "branch_1", summary: "Escalation" },
    });

    const interjection = await requestJson("POST", `/runs/${debate.body.run.id}/interjections`, {
      message: "The contract may be a recompete, not new demand.",
    });

    expect(interjection.status).toBe(201);
    expect(interjection.body.event).toMatchObject({
      runId: debate.body.run.id,
      type: "human.interjection",
      payload: {
        author: "human",
        message: "The contract may be a recompete, not new demand.",
      },
    });
  });

  it("streams historical run events as SSE", async () => {
    const { requestJson, request } = makeClient();
    const debate = await requestJson("POST", "/debates", {
      escalation: { branchId: "branch_1", summary: "Escalation" },
    });

    const response = await request("GET", `/runs/${debate.body.run.id}/events/stream`);
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    const chunk = await reader!.read();
    await reader!.cancel();

    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: run.started");
    expect(text).toContain("data:");
  });

  it("rejects invalid payloads with 400", async () => {
    const { requestJson } = makeClient();

    const response = await requestJson("POST", "/branches", { description: "missing name" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("bad_request");
  });
});

function makeClient() {
  const store = new MemoryKairosStore();
  const context: LocalApiContext = {
    store,
    runHeartbeat: async ({ branchId, dryRun, payload }) => ({
      output: { branchId, decision: "monitor", dryRun },
      events: [
        { type: "heartbeat.seeded", payload },
        { type: "heartbeat.decision", payload: { decision: "monitor" } },
      ],
    }),
    createDebate: async ({ dryRun, payload }) => ({
      output: { decision: "needs_review", dryRun },
      events: [
        { type: "debate.created", payload },
        { type: "debate.judge.summary", payload: { decision: "needs_review" } },
      ],
    }),
  };
  const handler = createLocalApiHandler(context);

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return handler(new Request(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }

  async function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const response = await request(method, path, body);
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    };
  }

  return { request, requestJson };
}
