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
