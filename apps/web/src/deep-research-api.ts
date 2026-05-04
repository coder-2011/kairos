import type { KairosReasoningEffort } from "../../../src/global/agent-config.js";

import { KairosApiError, type RouterToolCallRecord } from "./api";

export type DeepResearchModelOption = {
  id: string;
  label: string;
  provider: string;
  logo: string;
  reasoningEffort?: KairosReasoningEffort;
  note?: string;
};

export type DeepResearchChatRecord = {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeepResearchMessageRecord = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  createdAt: string;
  text?: string;
  model?: string;
  reasoning?: string;
  reasoningEffort?: KairosReasoningEffort;
  attachments?: DeepResearchImageAttachment[];
  toolCalls?: RouterToolCallRecord[];
};

export type DeepResearchStreamEvent =
  | {
      type: "assistant_delta";
      text: string;
    }
  | {
      type: "assistant_reasoning";
      text: string;
    }
  | {
      type: "assistant_tool";
      toolCall: RouterToolCallRecord;
    }
  | {
      type: "assistant_final";
      chat?: DeepResearchChatRecord;
      userMessage: DeepResearchMessageRecord;
      assistantMessage: DeepResearchMessageRecord;
    }
  | {
      type: "assistant_error";
      chat?: DeepResearchChatRecord;
      userMessage: DeepResearchMessageRecord;
      assistantMessage: DeepResearchMessageRecord;
      message: string;
    };

export type DeepResearchImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

const apiBaseUrl =
  import.meta.env.VITE_KAIROS_API_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:4321";

export async function getDeepResearchModels(): Promise<{
  defaultModel: string;
  models: DeepResearchModelOption[];
}> {
  return request("/deep-research/models");
}

export async function getDeepResearchChats(): Promise<DeepResearchChatRecord[]> {
  return request<{ chats: DeepResearchChatRecord[] }>("/deep-research/chats").then(
    (response) => response.chats,
  );
}

export async function createDeepResearchChat(): Promise<DeepResearchChatRecord> {
  return request<{ chat: DeepResearchChatRecord }>("/deep-research/chats", {
    method: "POST",
    body: JSON.stringify({}),
  }).then((response) => response.chat);
}

export async function getDeepResearchMessages(
  chatId: string,
): Promise<DeepResearchMessageRecord[]> {
  return request<{ messages: DeepResearchMessageRecord[] }>(
    `/deep-research/chats/${chatId}/messages`,
  ).then((response) => response.messages);
}

export async function sendDeepResearchMessage(input: {
  chatId: string;
  text: string;
  model: string;
  reasoningEffort?: "auto" | KairosReasoningEffort;
  attachments?: DeepResearchImageAttachment[];
}): Promise<{
  chat?: DeepResearchChatRecord;
  userMessage: DeepResearchMessageRecord;
  assistantMessage: DeepResearchMessageRecord;
}> {
  return request(`/deep-research/chats/${input.chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attachments: input.attachments ?? [],
    }),
  });
}

export async function* sendDeepResearchMessageStream(input: {
  chatId: string;
  text: string;
  model: string;
  reasoningEffort?: "auto" | KairosReasoningEffort;
  attachments?: DeepResearchImageAttachment[];
}): AsyncGenerator<DeepResearchStreamEvent> {
  const response = await fetch(`${apiBaseUrl}/deep-research/chats/${input.chatId}/messages/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attachments: input.attachments ?? [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const body = parseJsonOrText(text);
    const message =
      isJsonRecord(body) && typeof body.message === "string"
        ? body.message
        : text || `Kairos API request failed: ${response.status}`;
    throw new KairosApiError(message, response.status, body);
  }

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "";
  let eventData = "";
  const pending: DeepResearchStreamEvent[] = [];

  const emitPayload = (type: string, payload: unknown) => {
    if (!isJsonRecord(payload)) return;

    const normalizedType = normalizeStreamEventType(type);
    const payloadType = isJsonRecord(payload) && typeof payload.type === "string"
      ? normalizeStreamEventType(payload.type)
      : "";
    const normalized = ((): unknown => {
      if (payloadType || normalizedType) {
        return { ...payload, type: payloadType || normalizedType };
      }

      return payload;
    })();

    if (isValidDeepResearchStreamEvent(normalized as Record<string, unknown>)) {
      pending.push(normalized as DeepResearchStreamEvent);
    }
  };

  const flushEvent = () => {
    if (!eventType && !eventData) return;
    try {
      emitPayload(eventType, parseJsonOrText(eventData));
    } catch {
      // Ignore malformed stream payload chunks.
    } finally {
      eventType = "";
      eventData = "";
    }
  };

  const parseLine = (line: string) => {
    if (line === "") {
      if (eventType) flushEvent();
      return;
    }
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      const lineData = line.slice(5).trim();
      eventData = eventData ? `${eventData}\n${lineData}` : lineData;
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      flushEvent();
      if (pending.length > 0) {
        yield pending.shift() as DeepResearchStreamEvent;
      }
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let delimiterIndex: number;
    while ((delimiterIndex = buffer.indexOf("\n\n")) >= 0) {
      const packet = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);
      packet.split("\n").forEach(parseLine);
      while (pending.length > 0) {
        yield pending.shift() as DeepResearchStreamEvent;
      }
    }
  }

  while (pending.length > 0) {
    yield pending.shift() as DeepResearchStreamEvent;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const body = parseJsonOrText(text);
    const message =
      isJsonRecord(body) && typeof body.message === "string"
        ? body.message
        : text || `Kairos API request failed: ${response.status}`;
    throw new KairosApiError(message, response.status, body);
  }

  if (response.status === 204) return undefined as T;
  return parseJsonOrText(await response.text()) as T;
}

function parseJsonOrText(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStreamEventType(value: string): string {
  if (!value) return "";
  return value.replaceAll(".", "_");
}

function isValidDeepResearchStreamEvent(value: Record<string, unknown>): value is DeepResearchStreamEvent {
  return (
    (value.type === "assistant_delta" && typeof value.text === "string") ||
    (value.type === "assistant_reasoning" && typeof value.text === "string") ||
    (value.type === "assistant_tool" && isJsonRecord(value.toolCall)) ||
    (value.type === "assistant_final" && isJsonRecord(value.userMessage) && isJsonRecord(value.assistantMessage)) ||
    (value.type === "assistant_error" &&
      typeof value.message === "string" &&
      isJsonRecord(value.userMessage) &&
      isJsonRecord(value.assistantMessage))
  );
}
