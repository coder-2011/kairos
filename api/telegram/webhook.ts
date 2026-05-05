import { Readable } from "node:stream";
import { waitUntil } from "@vercel/functions";

import { createLocalApi } from "../../apps/local-api/src/server.js";

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string | string[]): void;
  send(body?: unknown): void;
  end(body?: unknown): void;
};

const api = createLocalApi();

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  const maybeGlobal = globalThis as typeof globalThis & {
    __kairosWaitUntil?: (promise: Promise<unknown>) => void;
  };
  const previousWaitUntil = maybeGlobal.__kairosWaitUntil;
  maybeGlobal.__kairosWaitUntil = (promise) => waitUntil(promise);

  try {
    const { handler: fetchHandler } = await api;
    const webRequest = await toWebRequest(request);
    const apiResponse = await fetchHandler(webRequest);

    response.status(apiResponse.status);
    apiResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });

    if (!apiResponse.body) {
      response.end();
      return;
    }

    const body = Buffer.from(await apiResponse.arrayBuffer());
    response.send(body);
  } finally {
    if (previousWaitUntil) {
      maybeGlobal.__kairosWaitUntil = previousWaitUntil;
    } else {
      delete maybeGlobal.__kairosWaitUntil;
    }
  }
}

async function toWebRequest(request: VercelRequest): Promise<Request> {
  const method = request.method ?? "GET";

  return new Request("https://kairos.vercel.app/telegram/webhook", {
    method,
    headers: normalizeHeaders(request.headers),
    body: ["GET", "HEAD"].includes(method.toUpperCase())
      ? undefined
      : await requestBody(request),
  });
}

function normalizeHeaders(
  headers: VercelRequest["headers"],
): HeadersInit {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
    } else if (value !== undefined) {
      normalized.set(key, value);
    }
  }
  return normalized;
}

async function requestBody(request: VercelRequest): Promise<BodyInit | undefined> {
  if (request.body === undefined || request.body === null) {
    return undefined;
  }
  if (typeof request.body === "string") {
    return request.body;
  }
  if (request.body instanceof Uint8Array) {
    const body = new Uint8Array(request.body.byteLength);
    body.set(request.body);
    return body.buffer as ArrayBuffer;
  }
  if (request.body instanceof Readable) {
    return Readable.toWeb(request.body) as BodyInit;
  }
  return JSON.stringify(request.body);
}
