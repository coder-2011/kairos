import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalApi,
  MemoryKairosStore,
  type LocalApiDependencies,
} from "./src/server.js";

type UpstreamRequest = {
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
};

const envKeys = [
  "KAIROS_AUTH_ENABLED",
  "KAIROS_TELEGRAM_NOTIFICATIONS_ENABLED",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "KAIROS_TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_API_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "KAIROS_NOTIFICATION_OPENROUTER_BASE_URL",
  "SUPERMEMORY_API_KEY",
] as const;

describe("Telegram notification E2E", () => {
  const originalEnv = new Map<string, string | undefined>();
  let apiServer: Server | undefined;
  let upstreamServer: Server | undefined;

  afterEach(async () => {
    await closeServer(apiServer);
    await closeServer(upstreamServer);
    apiServer = undefined;
    upstreamServer = undefined;

    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  it("binds a Telegram chat, formats a threshold alert, sends it through the Bot API, and records the result", async () => {
    snapshotEnv(originalEnv);
    const upstreamRequests: UpstreamRequest[] = [];
    const upstream = await startFakeUpstream(upstreamRequests);
    upstreamServer = upstream.server;

    process.env.KAIROS_AUTH_ENABLED = "false";
    process.env.KAIROS_TELEGRAM_NOTIFICATIONS_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "bot_token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
    process.env.TELEGRAM_BOT_API_BASE_URL = `${upstream.baseUrl}/telegram`;
    process.env.OPENROUTER_API_KEY = "openrouter_test";
    process.env.KAIROS_NOTIFICATION_OPENROUTER_BASE_URL = `${upstream.baseUrl}/openrouter`;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.KAIROS_TELEGRAM_CHAT_ID;
    delete process.env.SUPERMEMORY_API_KEY;

    const store = new MemoryKairosStore();
    const api = await startApiServer({
      store,
      now: () => new Date("2026-05-03T12:00:00.000Z"),
    });
    apiServer = api.server;

    const webhook = await requestJson(api.baseUrl, "POST", "/telegram/webhook", {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1,
        text: "/start",
        chat: { id: 12345, type: "private", username: "naman" },
      },
    }, { "x-telegram-bot-api-secret-token": "secret" });

    expect(webhook.status).toBe(200);
    expect(webhook.body).toMatchObject({ ok: true, action: "bound" });

    const tradeIntent = await requestJson(api.baseUrl, "POST", "/trade-intents", {
      symbol: "PLTR",
      side: "buy",
      notional: 500,
      confidence: 0.7,
      reasoning: "Debate found a material contract catalyst.",
      expectedCatalyst: "New material contract.",
      risk: "Market may have priced in the news.",
      timeHorizon: "1-4 weeks",
      positionSizingRationale: "Small paper order for observation.",
      invalidationCondition: "Contract report is contradicted.",
      exitCondition: "Catalyst is priced in or thesis breaks.",
      tradingConfig: {
        notifyConfidenceThreshold: 0.65,
        paperTradeConfidenceThreshold: 0.85,
      },
    });

    expect(tradeIntent.status).toBe(201);
    expect(tradeIntent.body.policy).toMatchObject({
      thresholdResult: "message_human",
      permittedAction: "message_human",
    });

    const openRouterRequest = upstreamRequests.find((request) =>
      request.path === "/openrouter/chat/completions"
    );
    expect(openRouterRequest).toBeDefined();
    expect(openRouterRequest?.authorization).toBe("Bearer openrouter_test");
    expect(openRouterRequest?.body).toMatchObject({
      model: "google/gemma-4-31b-it",
      temperature: 0.1,
      max_tokens: 260,
    });
    expect(JSON.stringify(openRouterRequest?.body)).toContain("Debate found a material contract catalyst.");

    const telegramMessages = upstreamRequests.filter((request) =>
      request.path === "/telegram/botbot_token/sendMessage"
    );
    expect(telegramMessages).toHaveLength(2);
    expect(telegramMessages[0]?.body).toMatchObject({
      chat_id: "12345",
      text: expect.stringContaining("Kairos Telegram alerts are connected"),
      disable_web_page_preview: true,
    });
    expect(telegramMessages[1]?.body).toEqual({
      chat_id: "12345",
      text: "PLTR 70% message_human: Debate found a material contract catalyst.",
      disable_web_page_preview: true,
    });

    const messages = await requestJson(api.baseUrl, "GET", "/messages");
    expect(messages.body.messages.map((message: { type: string }) => message.type)).toEqual([
      "threshold_notify",
      "telegram_notification_sent",
    ]);
    expect(messages.body.messages[1]).toMatchObject({
      body: "PLTR 70% message_human: Debate found a material contract catalyst.",
      metadata: {
        provider: "telegram",
        chatId: "12345",
        messageId: 102,
      },
    });

    const usage = await requestJson(api.baseUrl, "GET", "/usage-events?provider=telegram&limit=10");
    expect(usage.body.usageEvents).toHaveLength(2);
    expect(usage.body.usageEvents.map((event: { operation: string; status: string }) => ({
      operation: event.operation,
      status: event.status,
    }))).toEqual([
      { operation: "sendMessage", status: "succeeded" },
      { operation: "sendMessage", status: "succeeded" },
    ]);
  });
});

function snapshotEnv(originalEnv: Map<string, string | undefined>): void {
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key]);
  }
}

async function startFakeUpstream(
  requests: UpstreamRequest[],
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    const body = await readJsonBody(request);
    requests.push({
      path,
      authorization: request.headers.authorization,
      body,
    });

    if (path === "/openrouter/chat/completions") {
      return sendJson(response, {
        choices: [
          {
            message: {
              content: "PLTR 70% message_human: Debate found a material contract catalyst.",
            },
          },
        ],
      });
    }

    if (path === "/telegram/botbot_token/sendMessage") {
      return sendJson(response, {
        ok: true,
        result: {
          message_id: requests.filter((entry) =>
            entry.path === "/telegram/botbot_token/sendMessage"
          ).length + 100,
          date: 1,
          chat: { id: body.chat_id, type: "private" },
        },
      });
    }

    return sendJson(response, { ok: false, error: "not_found" }, 404);
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake upstream did not bind to a TCP port.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function startApiServer(
  dependencies: LocalApiDependencies,
): Promise<{ server: Server; baseUrl: string }> {
  const { handler } = await createLocalApi({ dependencies });
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : Readable.toWeb(request) as ReadableStream;
    const apiResponse = await handler(new Request(`http://${request.headers.host}${request.url ?? "/"}`, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers));
    if (apiResponse.body) {
      for await (const chunk of apiResponse.body) {
        response.write(chunk);
      }
    }
    response.end();
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Kairos API did not bind to a TCP port.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-kairos-local-request": "1",
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
