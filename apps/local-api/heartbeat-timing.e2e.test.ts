import { createServer, type IncomingMessage, type Server } from "node:http";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import { request as playwrightRequest, type APIRequestContext } from "playwright";

import {
  createLocalApi,
  SupabaseKairosStore,
  type LocalApiDependencies,
} from "./src/server.js";
import type { BranchRecord, JsonRecord } from "./src/store.js";

type SupabaseRecord = {
  collection: string;
  id: string;
  record: unknown;
};

describe("heartbeat timing E2E", () => {
  let server: Server | undefined;
  let api: APIRequestContext | undefined;

  afterEach(async () => {
    await api?.dispose();
    api = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
  });

  it("persists branch heartbeat timing in Supabase and only wakes active heartbeat branches over HTTP", async () => {
    const previousAuthEnabled = process.env.KAIROS_AUTH_ENABLED;
    const previousViteAuthEnabled = process.env.VITE_KAIROS_AUTH_ENABLED;
    process.env.KAIROS_AUTH_ENABLED = "false";
    process.env.VITE_KAIROS_AUTH_ENABLED = "false";

    const records = new Map<string, SupabaseRecord>();
    const heartbeatRuns = vi.fn<NonNullable<LocalApiDependencies["runHeartbeat"]>>(
      async ({ branchId, payload }) => ({
        output: {
          branchId,
          decision: "monitor",
          summary: "Timing-gated heartbeat accepted router source.",
        },
        events: [
          { type: "heartbeat.seeded", payload },
          { type: "heartbeat.decision", payload: { decision: "monitor" } },
        ],
      }),
    );

    try {
      const { baseUrl, closeServer } = await startApiServer({
        store: createFakeSupabaseStore(records),
        now: () => new Date("2026-05-03T12:00:00.000Z"),
        runHeartbeat: heartbeatRuns,
      });
      server = closeServer;
      api = await playwrightRequest.newContext({
        baseURL: baseUrl,
        extraHTTPHeaders: { "x-kairos-local-request": "1" },
      });

      await createTimedBranch(api, {
        id: "branch_disabled_heartbeat",
        name: "Disabled PLTR heartbeat",
        enabled: false,
        activeDays: ["sunday"],
      });
      await createTimedBranch(api, {
        id: "branch_closed_heartbeat",
        name: "Closed PLTR heartbeat",
        enabled: true,
        activeDays: ["monday"],
      });
      const activeBranch = await createTimedBranch(api, {
        id: "branch_active_heartbeat",
        name: "Active PLTR heartbeat",
        enabled: true,
        activeDays: ["sunday"],
        endDate: "2026-05-04",
      });

      expect(activeBranch.config?.heartbeat?.timing).toMatchObject({
        mode: "custom",
        activeDays: ["sunday"],
        startTime: "00:00",
        endTime: "23:59",
        endDate: "2026-05-04",
        timezone: "UTC",
      });
      expect(
        (records.get("branches:branch_active_heartbeat")?.record as BranchRecord)
          .config?.heartbeat?.timing,
      ).toEqual(activeBranch.config?.heartbeat?.timing);

      const chatResponse = await api.post("/router/chats", { data: {} });
      expect(chatResponse.status()).toBe(201);
      const chatBody = await chatResponse.json();

      const messageResponse = await api.post(
        `/router/chats/${chatBody.chat.id}/messages`,
        {
          data: {
            text: "PLTR contract source should only wake active heartbeat timing.",
          },
        },
      );
      expect(messageResponse.status()).toBe(201);
      const messageBody = await messageResponse.json();

      expect(messageBody.run.output.branchIds).toEqual(["branch_active_heartbeat"]);
      expect(messageBody.heartbeatRuns).toHaveLength(1);
      expect(messageBody.heartbeatRuns[0]).toMatchObject({
        branchId: "branch_active_heartbeat",
        kind: "heartbeat",
      });
      expect(heartbeatRuns).toHaveBeenCalledTimes(1);
      expect(heartbeatRuns.mock.calls[0]?.[0]).toMatchObject({
        branchId: "branch_active_heartbeat",
        branch: {
          config: {
            heartbeat: {
              enabled: true,
              timing: expect.objectContaining({ activeDays: ["sunday"] }),
            },
          },
        },
      });

      const eventsResponse = await api.get(`/runs/${messageBody.run.id}/events`);
      expect(eventsResponse.status()).toBe(200);
      const eventsBody = await eventsResponse.json();
      const inventoryPayload = eventsBody.events.find(
        (event: { type: string; payload?: JsonRecord }) =>
          event.type === "router.tool_call.completed" &&
          event.payload?.name === "branch_inventory",
      )?.payload as { output?: { branches?: Array<JsonRecord> } } | undefined;
      const inventory = inventoryPayload?.output?.branches;
      expect(inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "branch_disabled_heartbeat",
            heartbeatActive: false,
          }),
          expect.objectContaining({
            id: "branch_closed_heartbeat",
            heartbeatActive: false,
          }),
          expect.objectContaining({
            id: "branch_active_heartbeat",
            heartbeatActive: true,
          }),
        ]),
      );
    } finally {
      restoreEnv("KAIROS_AUTH_ENABLED", previousAuthEnabled);
      restoreEnv("VITE_KAIROS_AUTH_ENABLED", previousViteAuthEnabled);
    }
  });
});

async function createTimedBranch(
  api: APIRequestContext,
  input: {
    id: string;
    name: string;
    enabled: boolean;
    activeDays: string[];
    endDate?: string;
  },
): Promise<BranchRecord> {
  const response = await api.post("/branches", {
    data: {
      id: input.id,
      name: input.name,
      description: "Watch PLTR contract catalysts.",
      law: { thesis: "Watch for material PLTR contracts." },
      config: {
        assets: ["PLTR"],
        heartbeat: {
          enabled: input.enabled,
          intervalMinutes: 5,
          seedWindowDays: 30,
          maxToolSteps: 2,
          timing: {
            mode: "custom",
            activeDays: input.activeDays,
            startTime: "00:00",
            endTime: "23:59",
            endDate: input.endDate,
            timezone: "UTC",
          },
        },
      },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.branch as BranchRecord;
}

function createFakeSupabaseStore(records: Map<string, SupabaseRecord>) {
  return new SupabaseKairosStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "service_role_test",
    fetchImpl: (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      if (method === "POST" && body) {
        records.set(`${body.collection}:${body.id}`, body);
        return jsonResponse(null);
      }

      if (method === "GET") {
        const collection = url.searchParams.get("collection")?.replace(/^eq\./, "");
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const runId = url.searchParams.get("record->>runId")?.replace(/^eq\./, "");
        const chatId = url.searchParams.get("record->>chatId")?.replace(/^eq\./, "");
        const rows = [...records.values()].filter((row) => {
          const record = row.record as { runId?: string; chatId?: string };
          return (
            (!collection || row.collection === collection) &&
            (!id || row.id === id) &&
            (!runId || record.runId === runId) &&
            (!chatId || record.chatId === chatId)
          );
        });
        return jsonResponse(rows);
      }

      if (method === "DELETE") {
        const collection = url.searchParams.get("collection")?.replace(/^eq\./, "");
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const key = `${collection}:${id}`;
        const row = records.get(key);
        records.delete(key);
        return jsonResponse(row ? [row] : []);
      }

      return jsonResponse({ error: "unexpected request" }, 500);
    }) as typeof fetch,
  });
}

async function startApiServer(
  dependencies: LocalApiDependencies,
): Promise<{ baseUrl: string; closeServer: Server }> {
  const { handler } = await createLocalApi({ dependencies });
  const server = createServer(
    async (request: IncomingMessage, response) => {
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : (Readable.toWeb(request) as ReadableStream);
      const apiResponse = await handler(
        new Request(`http://${request.headers.host}${request.url ?? "/"}`, {
          method: request.method,
          headers: request.headers as HeadersInit,
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );

      response.writeHead(
        apiResponse.status,
        Object.fromEntries(apiResponse.headers),
      );
      if (apiResponse.body) {
        for await (const chunk of apiResponse.body) {
          response.write(chunk);
        }
      }
      response.end();
    },
  );

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local API test server did not expose a TCP address.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    closeServer: server,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
