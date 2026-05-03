import { createServer, type IncomingMessage, type Server } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { request as playwrightRequest, type APIRequestContext } from "playwright";

import { createLocalApi, type LocalApiContext } from "./src/server.js";
import { MemoryKairosStore } from "./src/store.js";
import type {
  SupermemoryMirror,
  SupermemoryMirrorRecord,
} from "../../src/global/index.js";

describe("Supermemory branch profile E2E", () => {
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

  it("routes human source ingestion through branch-specific Supermemory profile tags over HTTP", async () => {
    const mirrored: SupermemoryMirrorRecord[] = [];
    const { baseUrl, closeServer } = await startApiServer({
      store: new MemoryKairosStore(),
      supermemoryMirror: createRecordingMirror(mirrored),
      runHeartbeat: async ({ branchId, dryRun, payload }) => ({
        output: {
          branchId,
          decision: "monitor",
          dryRun,
          summary: "Dry-run heartbeat accepted router-origin source.",
        },
        events: [
          { type: "heartbeat.seeded", payload },
          { type: "heartbeat.decision", payload: { decision: "monitor" } },
        ],
      }),
    });
    server = closeServer;
    api = await playwrightRequest.newContext({ baseURL: baseUrl });

    const branchResponse = await api.post("/branches", {
      data: {
        id: "branch_e2e_profile",
        lawId: "law_e2e_profile",
        name: "PLTR government contracts",
        description: "Watch PLTR government contract catalysts.",
        config: { assets: ["PLTR"] },
        law: { watchFor: "new government contracts" },
      },
    });
    expect(branchResponse.status()).toBe(201);

    const chatResponse = await api.post("/router/chats", { data: {} });
    expect(chatResponse.status()).toBe(201);
    const chatBody = await chatResponse.json();

    const messageResponse = await api.post(
      `/router/chats/${chatBody.chat.id}/messages`,
      {
        data: {
          text: "PLTR government contract source should route to this branch.",
          dryRun: true,
        },
      },
    );
    expect(messageResponse.status()).toBe(201);
    const messageBody = await messageResponse.json();

    expect(messageBody.run.status).toBe("succeeded");
    expect(messageBody.run.output.branchIds).toEqual(["branch_e2e_profile"]);
    expect(messageBody.heartbeatRuns).toHaveLength(1);

    const sourceMirror = mirrored.find(
      (record) => record.type === "router.source.ingested",
    );
    expect(sourceMirror).toMatchObject({
      scope: "source",
      runId: messageBody.run.id,
      containerTags: expect.arrayContaining([
        "branch_branch_e2e_profile",
        "branch_profile_branch_e2e_profile",
      ]),
      data: expect.objectContaining({
        branchIds: ["branch_e2e_profile"],
      }),
    });
    expect(
      mirrored.find((record) => record.type === "heartbeat.seeded"),
    ).toMatchObject({
      scope: "run_event",
      branchId: "branch_e2e_profile",
    });
  });
});

async function startApiServer(
  dependencies: Partial<LocalApiContext>,
): Promise<{ baseUrl: string; closeServer: Server }> {
  const { handler } = await createLocalApi({
    dependencies: dependencies as LocalApiContext,
  });
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

function createRecordingMirror(records: SupermemoryMirrorRecord[]): SupermemoryMirror {
  return {
    async mirrorRecord(record) {
      records.push(record);
    },
    async mirrorDebateResult(input) {
      records.push({
        type: "debate_transcript",
        scope: "debate",
        runId: input.runId,
        branchId: input.branchId,
        lawId: input.lawId,
        debateId: input.result.debateId,
        data: input.result,
      });
    },
    async mirrorInformationResult(input) {
      records.push({
        type: "information_result",
        scope: "information",
        runId: input.runId,
        branchId: input.branchId,
        lawId: input.lawId,
        summary: input.result.summary,
        data: input,
      });
    },
  };
}
