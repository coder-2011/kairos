import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  kairosBranchAgentConfigSchema,
  listOpenRouterModels,
} from "../../../src/global/index.js";
import { createRuntimeStore } from "./runtime.js";
import {
  MemoryKairosStore,
  type AppendRunEventInput,
  type BranchRecord,
  type KairosLocalStore,
  type JsonRecord,
} from "./store.js";

export type LocalApiDependencies = {
  store?: KairosLocalStore;
  runHeartbeat?: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate?: (input: DebateCreateInput) => Promise<DebateCreateResult>;
};

export type LocalApiOptions = {
  dependencies?: LocalApiDependencies;
  dataDir?: string;
};

export type LocalApiContext = {
  store: KairosLocalStore;
  runHeartbeat: (input: HeartbeatTriggerInput) => Promise<HeartbeatRunResult>;
  createDebate: (input: DebateCreateInput) => Promise<DebateCreateResult>;
};

type HeartbeatTriggerInput = {
  branchId: string;
  dryRun: boolean;
  payload: JsonRecord;
  branch: BranchRecord;
};

type HeartbeatRunResult = {
  output: JsonRecord;
  events?: AppendRunEventInput[];
};

type DebateCreateInput = {
  dryRun: boolean;
  payload: JsonRecord;
  branch?: BranchRecord;
};

type DebateCreateResult = {
  output: JsonRecord;
  events?: AppendRunEventInput[];
};

const branchCreateSchema = z.object({
  id: z.string().min(1).optional(),
  lawId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  law: z.record(z.string(), z.unknown()).optional(),
  config: kairosBranchAgentConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const branchUpdateSchema = branchCreateSchema.omit({ id: true }).partial();

const heartbeatTriggerSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const debateCreateSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  escalation: z.record(z.string(), z.unknown()).optional(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const interjectionSchema = z.object({
  author: z.string().min(1).optional().default("human"),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function createLocalApiContext(options: LocalApiOptions = {}): Promise<LocalApiContext> {
  const store = options.dependencies?.store ?? await createRuntimeStore({ dataDir: options.dataDir });
  return {
    store,
    runHeartbeat: options.dependencies?.runHeartbeat ?? deterministicHeartbeat,
    createDebate: options.dependencies?.createDebate ?? deterministicDebate,
  };
}

export function createLocalApiHandler(context: LocalApiContext): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);

    try {
      if (request.method === "OPTIONS") return empty(204);
      if (!route) return json({ error: "not_found", message: "Route not found." }, 404);

      switch (route.name) {
        case "health":
          return json({ ok: true, service: "kairos-local-api", mode: "local" });

        case "listOpenRouterModels":
          return json({ models: await listOpenRouterModels({ requireTools: true }) });

        case "listBranches":
          return json({ branches: await context.store.listBranches() });

        case "createBranch":
          return json({ branch: await context.store.createBranch(branchCreateSchema.parse(await readJson(request))) }, 201);

        case "getBranch": {
          const branch = await context.store.getBranch(route.params.branchId);
          return branch ? json({ branch }) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "updateBranch": {
          const branch = await context.store.updateBranch(route.params.branchId, branchUpdateSchema.parse(await readJson(request)));
          return branch ? json({ branch }) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "deleteBranch": {
          const deleted = await context.store.deleteBranch(route.params.branchId);
          return deleted ? empty(204) : json({ error: "not_found", message: "Branch not found." }, 404);
        }

        case "listRuns":
          return json({ runs: await context.store.listRuns() });

        case "getRun": {
          const run = await context.store.getRun(route.params.runId);
          return run ? json({ run }) : json({ error: "not_found", message: "Run not found." }, 404);
        }

        case "listRunEvents": {
          const run = await context.store.getRun(route.params.runId);
          if (!run) return json({ error: "not_found", message: "Run not found." }, 404);
          return json({ events: await context.store.listRunEvents(route.params.runId) });
        }

        case "triggerHeartbeat":
          return triggerHeartbeat(context, route.params.branchId, await readJson(request));

        case "createDebate":
          return createDebate(context, await readJson(request));

        case "appendInterjection":
          return appendInterjection(context, route.params.runId, await readJson(request));

        case "streamRunEvents":
          return streamRunEvents(context, route.params.runId);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ error: "bad_request", issues: error.issues }, 400);
      }
      return json({ error: "internal_error", message: error instanceof Error ? error.message : "Unknown error." }, 500);
    }
  };
}

export async function createLocalApi(options: LocalApiOptions = {}): Promise<{ context: LocalApiContext; handler: (request: Request) => Promise<Response> }> {
  const context = await createLocalApiContext(options);
  return { context, handler: createLocalApiHandler(context) };
}

export async function serveLocalApi(options: LocalApiOptions & { port?: number; hostname?: string } = {}) {
  const { handler } = await createLocalApi(options);
  const port = options.port ?? Number(process.env.KAIROS_LOCAL_API_PORT ?? 4321);
  const hostname = options.hostname ?? process.env.KAIROS_LOCAL_API_HOST ?? "127.0.0.1";

  if ("Bun" in globalThis) {
    const bun = (globalThis as typeof globalThis & { Bun: { serve: (options: { port: number; hostname: string; fetch: (request: Request) => Promise<Response> }) => unknown } }).Bun;
    return bun.serve({ port, hostname, fetch: handler });
  }

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request) as ReadableStream;
    const apiResponse = await handler(new Request(`http://${request.headers.host ?? `${hostname}:${port}`}${request.url ?? "/"}`, {
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

  server.listen(port, hostname);
  return server;
}

async function triggerHeartbeat(context: LocalApiContext, branchId: string, body: unknown): Promise<Response> {
  const branch = await context.store.getBranch(branchId);
  if (!branch) return json({ error: "not_found", message: "Branch not found." }, 404);

  const input = heartbeatTriggerSchema.parse(body);
  const runPayload = {
    ...input.input,
    branch: branchRunContext(branch),
  };
  const run = await context.store.createRun({
    kind: "heartbeat",
    status: "running",
    branchId,
    dryRun: input.dryRun,
    input: runPayload,
    metadata: { source: input.dryRun ? "dry_run" : "runtime" },
  });
  await context.store.appendRunEvent(run.id, { type: "run.started", payload: { kind: "heartbeat", branchId, dryRun: input.dryRun } });

  let result: HeartbeatRunResult;
  try {
    result = await context.runHeartbeat({
      branchId,
      dryRun: input.dryRun,
      payload: runPayload,
      branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: message },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: message },
    });
    return json({ run: failed, error: "run_failed", message }, 500);
  }
  for (const event of result.events ?? []) {
    await context.store.appendRunEvent(run.id, event);
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return json({ run: completed }, 201);
}

async function createDebate(context: LocalApiContext, body: unknown): Promise<Response> {
  const input = debateCreateSchema.parse(body);
  const payload: JsonRecord = { ...input.input, escalation: input.escalation ?? input.input.escalation };
  const escalation = isJsonRecord(payload.escalation) ? payload.escalation : undefined;
  const branchId =
    typeof payload.branchId === "string"
      ? payload.branchId
      : typeof escalation?.branchId === "string"
        ? escalation.branchId
        : undefined;
  const branch = branchId ? await context.store.getBranch(branchId) : undefined;
  const runPayload = branch
    ? { ...payload, branch: branchRunContext(branch) }
    : payload;
  const run = await context.store.createRun({
    kind: "debate",
    status: "running",
    branchId,
    dryRun: input.dryRun,
    input: runPayload,
    metadata: { source: input.dryRun ? "dry_run" : "runtime" },
  });
  await context.store.appendRunEvent(run.id, { type: "run.started", payload: { kind: "debate", dryRun: input.dryRun } });

  let result: DebateCreateResult;
  try {
    result = await context.createDebate({
      dryRun: input.dryRun,
      payload: runPayload,
      branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: message },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: message },
    });
    return json({ run: failed, error: "run_failed", message }, 500);
  }
  for (const event of result.events ?? []) {
    await context.store.appendRunEvent(run.id, event);
  }
  const completed = await context.store.updateRun(run.id, { status: "succeeded", output: result.output });
  await context.store.appendRunEvent(run.id, { type: "run.completed", payload: { status: "succeeded" } });

  return json({ run: completed }, 201);
}

async function appendInterjection(context: LocalApiContext, runId: string, body: unknown): Promise<Response> {
  const run = await context.store.getRun(runId);
  if (!run) return json({ error: "not_found", message: "Run not found." }, 404);

  const input = interjectionSchema.parse(body);
  const event = await context.store.appendRunEvent(runId, {
    type: "human.interjection",
    payload: {
      author: input.author,
      message: input.message,
      metadata: input.metadata,
    },
  });
  return json({ event }, 201);
}

async function streamRunEvents(context: LocalApiContext, runId: string): Promise<Response> {
  const run = await context.store.getRun(runId);
  if (!run) return json({ error: "not_found", message: "Run not found." }, 404);

  const encoder = new TextEncoder();
  const historicalEvents = await context.store.listRunEvents(runId);
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of historicalEvents) {
        controller.enqueue(encoder.encode(formatSseEvent(event)));
      }

      if (context.store.subscribeToRunEvents) {
        unsubscribe = context.store.subscribeToRunEvents(runId, (event) => {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        });
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function deterministicHeartbeat(input: HeartbeatTriggerInput): Promise<HeartbeatRunResult> {
  if (!input.dryRun) {
    throw new Error("Agent pipeline heartbeat is not configured for this local API process.");
  }

  const summary = input.dryRun
    ? `Dry-run heartbeat checked branch ${input.branchId}.`
    : `Local heartbeat placeholder checked branch ${input.branchId}.`;
  return Promise.resolve({
    output: {
      branchId: input.branchId,
      decision: "monitor",
      summary,
      confidence: 0.1,
      dryRun: input.dryRun,
    },
    events: [
      { type: "heartbeat.seeded", payload: { deterministic: true, input: input.payload } },
      { type: "heartbeat.decision", payload: { decision: "monitor", summary } },
    ],
  });
}

function deterministicDebate(input: DebateCreateInput): Promise<DebateCreateResult> {
  if (!input.dryRun) {
    throw new Error("Agent pipeline debate is not configured for this local API process.");
  }

  return Promise.resolve({
    output: {
      decision: "needs_review",
      summary: input.dryRun
        ? "Dry-run debate record created from escalation payload."
        : "Local debate placeholder created from escalation payload.",
      dryRun: input.dryRun,
    },
    events: [
      { type: "debate.created", payload: { deterministic: true, escalation: input.payload.escalation ?? null } },
      { type: "debate.judge.summary", payload: { decision: "needs_review" } },
    ],
  });
}

function branchRunContext(branch: BranchRecord): JsonRecord {
  return {
    id: branch.id,
    lawId: branch.lawId,
    name: branch.name,
    description: branch.description,
    enabled: branch.enabled,
    law: branch.law,
    config: branch.config,
    metadata: branch.metadata,
  };
}

type Route =
  | { name: "health"; params: Record<string, never> }
  | { name: "listOpenRouterModels"; params: Record<string, never> }
  | { name: "listBranches"; params: Record<string, never> }
  | { name: "createBranch"; params: Record<string, never> }
  | { name: "getBranch"; params: { branchId: string } }
  | { name: "updateBranch"; params: { branchId: string } }
  | { name: "deleteBranch"; params: { branchId: string } }
  | { name: "listRuns"; params: Record<string, never> }
  | { name: "getRun"; params: { runId: string } }
  | { name: "listRunEvents"; params: { runId: string } }
  | { name: "triggerHeartbeat"; params: { branchId: string } }
  | { name: "createDebate"; params: Record<string, never> }
  | { name: "appendInterjection"; params: { runId: string } }
  | { name: "streamRunEvents"; params: { runId: string } };

function matchRoute(method: string, pathname: string): Route | undefined {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "GET" && pathname === "/health") return { name: "health", params: {} };
  if (method === "GET" && pathname === "/openrouter/models") return { name: "listOpenRouterModels", params: {} };
  if (segments.length === 1 && segments[0] === "branches") {
    if (method === "GET") return { name: "listBranches", params: {} };
    if (method === "POST") return { name: "createBranch", params: {} };
  }
  if (segments.length === 2 && segments[0] === "branches") {
    if (method === "GET") return { name: "getBranch", params: { branchId: segments[1] } };
    if (method === "PATCH") return { name: "updateBranch", params: { branchId: segments[1] } };
    if (method === "DELETE") return { name: "deleteBranch", params: { branchId: segments[1] } };
  }
  if (method === "POST" && segments.length === 3 && segments[0] === "branches" && segments[2] === "heartbeat-runs") {
    return { name: "triggerHeartbeat", params: { branchId: segments[1] } };
  }
  if (segments.length === 1 && segments[0] === "runs" && method === "GET") return { name: "listRuns", params: {} };
  if (segments.length === 2 && segments[0] === "runs" && method === "GET") return { name: "getRun", params: { runId: segments[1] } };
  if (segments.length === 3 && segments[0] === "runs" && segments[2] === "events" && method === "GET") {
    return { name: "listRunEvents", params: { runId: segments[1] } };
  }
  if (segments.length === 4 && segments[0] === "runs" && segments[2] === "events" && segments[3] === "stream" && method === "GET") {
    return { name: "streamRunEvents", params: { runId: segments[1] } };
  }
  if (segments.length === 3 && segments[0] === "runs" && segments[2] === "interjections" && method === "POST") {
    return { name: "appendInterjection", params: { runId: segments[1] } };
  }
  if (segments.length === 1 && segments[0] === "debates" && method === "POST") return { name: "createDebate", params: {} };

  return undefined;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json",
    },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: corsHeaders() });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function formatSseEvent(event: { id: string; type: string; timestamp: string; payload: JsonRecord }): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { MemoryKairosStore };
