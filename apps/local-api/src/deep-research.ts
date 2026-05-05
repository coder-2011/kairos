import { randomUUID } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  streamText,
  stepCountIs,
  tool,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { ExaApi } from "../../../src/api/exa.js";
import { SupermemoryApi } from "../../../src/api/supermemory.js";
import {
  kairosReasoningEffortSchema,
  type KairosReasoningEffort,
} from "../../../src/global/agent-config.js";
import {
  createOpenRouterChatModelForRole,
  createSupermemoryMemoryApi,
  getMemoryContainerTag,
} from "../../../src/global/index.js";
import { runInformationAgent } from "../../../src/agents/information/index.js";
import { FinnhubApi } from "../../../src/api/finnhub.js";
import type {
  BranchRecord,
  DeepResearchChatRecord,
  DeepResearchImageAttachment,
  DeepResearchMessageRecord,
  JsonRecord,
  KairosLocalStore,
  RouterToolCallRecord,
  RunRecord,
} from "./store.js";

export type DeepResearchModelOption = {
  id: string;
  label: string;
  provider: string;
  logo: string;
  reasoningEffort?: KairosReasoningEffort;
  note?: string;
};

export type DeepResearchContext = {
  store: KairosLocalStore;
};

export type DeepResearchStore = Pick<
  KairosLocalStore,
  | "listDeepResearchChats"
  | "createDeepResearchChat"
  | "getDeepResearchChat"
  | "deleteDeepResearchChat"
  | "listDeepResearchMessages"
  | "createDeepResearchMessage"
>;

export const DEEP_RESEARCH_DEFAULT_MODEL = "anthropic/claude-opus-4.7";

export const DEEP_RESEARCH_MODELS: DeepResearchModelOption[] = [
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    provider: "Anthropic",
    logo: "A",
    reasoningEffort: "high",
  },
  {
    id: "~anthropic/claude-sonnet-latest",
    label: "Claude Sonnet Latest",
    provider: "Anthropic",
    logo: "A",
    reasoningEffort: "high",
    note: "OpenRouter does not currently list a Sonnet 4.7 ID; this uses the canonical latest Sonnet alias.",
  },
  {
    id: "x-ai/grok-3",
    label: "Grok 3",
    provider: "xAI",
    logo: "xAI",
    reasoningEffort: "high",
  },
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    provider: "OpenAI",
    logo: "O",
    reasoningEffort: "xhigh",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    provider: "Google",
    logo: "G",
    reasoningEffort: "high",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super",
    provider: "NVIDIA",
    logo: "N",
    reasoningEffort: "high",
  },
  {
    id: "minimax/minimax-m2.7",
    label: "MiniMax M2.7",
    provider: "MiniMax",
    logo: "M",
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    provider: "MoonshotAI",
    logo: "K",
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    logo: "DS",
    reasoningEffort: "high",
  },
];

const messageCreateSchema = z.object({
  text: z.string().optional().default(""),
  model: z.string().min(1).optional(),
  reasoningEffort: kairosReasoningEffortSchema.optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        mimeType: z.string().regex(/^image\/(?:png|jpe?g|webp|gif)$/),
        dataUrl: z.string().regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,/),
      }).strict(),
    )
    .max(6)
    .optional()
    .default([]),
});

export type DeepResearchMessageInput = z.infer<typeof messageCreateSchema>;

export type DeepResearchRunOptions = {
  systemPrompt?: string;
  memoryQuery?: string;
  maxSteps?: number;
  temperature?: number;
};

const chatCreateSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

const DEFAULT_MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;
const LOCAL_REQUEST_HEADER = "x-kairos-local-request";
const LOCAL_TOKEN_HEADER = "x-kairos-local-token";
const REQUEST_ID_HEADER = "x-request-id";
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const SENSITIVE_RESPONSE_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key|stack)/i;

class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds the configured ${maxBytes} byte limit.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function handleDeepResearchRequest(
  context: DeepResearchContext,
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "deep-research") return undefined;

  try {
    if (request.method === "OPTIONS") return empty(204);
    if (request.method === "GET" && segments.length === 2 && segments[1] === "models") {
      return json({
        defaultModel: DEEP_RESEARCH_DEFAULT_MODEL,
        models: DEEP_RESEARCH_MODELS,
      });
    }

    const store = context.store;
    if (segments.length === 2 && segments[1] === "chats") {
      if (request.method === "GET") return json({ chats: await store.listDeepResearchChats() });
      if (request.method === "POST") {
        return json({
          chat: await store.createDeepResearchChat(
            chatCreateSchema.parse(await readJson(request)),
          ),
        }, 201);
      }
    }
    if (segments.length === 3 && segments[1] === "chats" && request.method === "DELETE") {
      const chatId = segments[2];
      const deleted = await store.deleteDeepResearchChat(chatId);
      return deleted ? empty(204) : json({ error: "not_found", message: "Deep Research chat not found." }, 404);
    }

    if (segments.length === 4 && segments[1] === "chats" && segments[3] === "messages") {
      const chatId = segments[2];
      const chat = await store.getDeepResearchChat(chatId);
      if (!chat) return json({ error: "not_found", message: "Deep Research chat not found." }, 404);
      if (request.method === "GET") return json({ messages: await store.listDeepResearchMessages(chatId) });
      if (request.method === "POST") {
        const input = messageCreateSchema.parse(await readJson(request));
        if (!input.text.trim() && input.attachments.length === 0) {
          return json({ error: "bad_request", message: "Deep Research message is empty." }, 400);
        }
        if (shouldEnqueueDeepResearchJob()) {
          const run = await context.store.createRun({
            kind: "deep_research",
            status: "pending",
            input: {
              chatId,
              message: input as unknown as JsonRecord,
            },
            metadata: {
              source: "runtime",
              jobKind: "deep_research",
              durableJob: true,
            },
          });
          await context.store.appendRunEvent(run.id, {
            type: "job.enqueued",
            payload: { kind: "deep_research", chatId },
          });
          return json({ chat, run }, 202);
        }
        return runDeepResearchMessage(context, store, chat, input);
      }
    }

    if (
      segments.length === 5 &&
      segments[1] === "chats" &&
      segments[3] === "messages" &&
      segments[4] === "stream"
    ) {
      const chatId = segments[2];
      const chat = await store.getDeepResearchChat(chatId);
      if (!chat) return json({ error: "not_found", message: "Deep Research chat not found." }, 404);
      if (request.method === "POST") {
        const input = messageCreateSchema.parse(await readJson(request));
        if (!input.text.trim() && input.attachments.length === 0) {
          return json({ error: "bad_request", message: "Deep Research message is empty." }, 400);
        }
        return runDeepResearchMessageStream(context, store, chat, input);
      }
    }

    return json({ error: "not_found", message: "Deep Research route not found." }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: "bad_request", issues: error.issues }, 400);
    }
    if (error instanceof RequestBodyTooLargeError) {
      return json({
        error: "payload_too_large",
        message: error.message,
        maxBytes: error.maxBytes,
      }, 413);
    }
    if (error instanceof SyntaxError) {
      return json({ error: "bad_request", message: "Request body must be valid JSON." }, 400);
    }
    return json({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error.",
    }, 500);
  }
}

export async function runDeepResearchQuery(
  context: DeepResearchContext,
  input: Pick<z.infer<typeof messageCreateSchema>, "text" | "model" | "reasoningEffort">,
): Promise<{
  text: string;
  reasoning?: string;
  model: string;
  reasoningEffort?: KairosReasoningEffort;
  toolCalls: RouterToolCallRecord[];
}> {
  const model = resolveDeepResearchModel(input.model);
  const reasoningEffort = resolveDeepResearchReasoningEffort(model, input.reasoningEffort);
  const toolCalls: RouterToolCallRecord[] = [];
  const memoryContext = await buildDeepResearchMemoryContext(context, input.text, toolCalls);

  const result = await generateText({
    model: createDeepResearchOpenRouterModel(model, reasoningEffort),
    system: deepResearchSystemPrompt(),
    messages: [
      ...(memoryContext ? [{ role: "user" as const, content: memoryContext }] : []),
      { role: "user", content: input.text },
    ],
    tools: createDeepResearchTools(context, toolCalls, { reasoningEffort }),
    temperature: 0.2,
  });

  const assistantText = result.text?.trim() ??
    `No direct answer was produced. I collected ${toolCalls.length} tool result${toolCalls.length === 1 ? "" : "s"} and no verified conclusion. Try a narrower query.`;
  const reasoning = extractDeepResearchReasoning(result as { reasoning?: unknown });

  return {
    text: assistantText,
    reasoning,
    model,
    reasoningEffort,
    toolCalls,
  };
}

export async function executeQueuedDeepResearchRun(
  context: DeepResearchContext,
  run: RunRecord,
): Promise<RunRecord> {
  const chatId = typeof run.input.chatId === "string" ? run.input.chatId : undefined;
  const message = isJsonRecord(run.input.message) ? run.input.message : undefined;
  const input = messageCreateSchema.parse(message ?? {});
  if (!chatId) {
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: "Queued Deep Research run is missing chatId." },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: "Queued Deep Research run is missing chatId." },
    });
    return failed ?? run;
  }

  const chat = await context.store.getDeepResearchChat(chatId);
  if (!chat) {
    const failed = await context.store.updateRun(run.id, {
      status: "failed",
      output: { error: "Queued Deep Research chat not found." },
    });
    await context.store.appendRunEvent(run.id, {
      type: "run.failed",
      payload: { error: "Queued Deep Research chat not found." },
    });
    return failed ?? run;
  }

  await context.store.updateRun(run.id, { status: "running" });
  await context.store.appendRunEvent(run.id, {
    type: "run.started",
    payload: { kind: "deep_research", chatId },
  });
  const response = await runDeepResearchMessage(context, context.store, chat, input);
  const body = await response.json() as JsonRecord;
  const status = response.status >= 400 ? "failed" : "succeeded";
  const completed = await context.store.updateRun(run.id, {
    status,
    output: body,
  });
  await context.store.appendRunEvent(run.id, {
    type: status === "succeeded" ? "run.completed" : "run.failed",
    payload: {
      status,
      httpStatus: response.status,
      error: typeof body.message === "string" ? body.message : undefined,
    },
  });
  return completed ?? run;
}

async function runDeepResearchMessage(
  context: DeepResearchContext,
  store: DeepResearchStore,
  chat: DeepResearchChatRecord,
  input: DeepResearchMessageInput,
): Promise<Response> {
  return runDeepResearchChatMessage(context, store, chat, input);
}

export async function runDeepResearchChatMessage(
  context: DeepResearchContext,
  store: DeepResearchStore,
  chat: DeepResearchChatRecord,
  input: DeepResearchMessageInput,
  options: DeepResearchRunOptions = {},
): Promise<Response> {
  const model = resolveDeepResearchModel(input.model);
  const reasoningEffort = resolveDeepResearchReasoningEffort(model, input.reasoningEffort);
  const chatTitle = chat.title ?? await generateDeepResearchTitle(input.text);
  const userMessage = await store.createDeepResearchMessage({
    chatId: chat.id,
    role: "user",
    text: input.text.trim(),
    attachments: input.attachments,
    chatTitle,
  });
  const previousMessages = await store.listDeepResearchMessages(chat.id);
  const toolCalls: RouterToolCallRecord[] = [];
  const memoryContext = await buildDeepResearchMemoryContext(
    context,
    options.memoryQuery ?? input.text,
    toolCalls,
  );
  const modelMessages = [
    ...previousMessages
      .filter((message) => message.id !== userMessage.id)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.text ?? "",
      })),
    ...(memoryContext
      ? [{
        role: "user" as const,
        content: memoryContext,
      }]
      : []),
    {
      role: "user" as const,
      content: deepResearchUserContent(userMessage),
    },
  ];

  try {
    const result = await generateText({
      model: createDeepResearchOpenRouterModel(model, reasoningEffort),
      system: options.systemPrompt ?? deepResearchSystemPrompt(),
      messages: modelMessages as never,
      tools: createDeepResearchTools(context, toolCalls, { reasoningEffort }),
      stopWhen: stepCountIs(options.maxSteps ?? 8),
      temperature: options.temperature ?? 0.2,
    });
    const assistantText = result.text?.trim();
    const reasoning = extractDeepResearchReasoning(result);
    const assistantMessage = await store.createDeepResearchMessage({
      chatId: chat.id,
      role: "assistant",
      text: assistantText?.length
        ? result.text
        : `No direct answer was produced. I collected ${toolCalls.length} tool result${toolCalls.length === 1 ? "" : "s"} and no verified conclusion. Try a narrower query.`,
      reasoning,
      model,
      reasoningEffort,
      toolCalls,
    });

    await mirrorDeepResearchConversation(chat.id, userMessage, assistantMessage);
    return json({
      chat: await store.getDeepResearchChat(chat.id),
      userMessage,
      assistantMessage,
      toolCalls,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const assistantMessage = await store.createDeepResearchMessage({
      chatId: chat.id,
      role: "assistant",
      text: `Deep Research failed: ${message}`,
      reasoning: `FAILED: ${message}`,
      model,
      reasoningEffort,
      toolCalls,
    });
    return json({ userMessage, assistantMessage, error: "run_failed", message }, 500);
  }
}

async function runDeepResearchMessageStream(
  context: DeepResearchContext,
  store: DeepResearchStore,
  chat: DeepResearchChatRecord,
  input: z.infer<typeof messageCreateSchema>,
): Promise<Response> {
  const model = resolveDeepResearchModel(input.model);
  const reasoningEffort = resolveDeepResearchReasoningEffort(model, input.reasoningEffort);
  const chatTitle = chat.title ?? await generateDeepResearchTitle(input.text);
  const userMessage = await store.createDeepResearchMessage({
    chatId: chat.id,
    role: "user",
    text: input.text.trim(),
    attachments: input.attachments,
    chatTitle,
  });

  const previousMessages = await store.listDeepResearchMessages(chat.id);
  const toolCalls: RouterToolCallRecord[] = [];
  const memoryContext = await buildDeepResearchMemoryContext(context, input.text, toolCalls);
  let assistantReasoning = "";
  const modelMessages = [
    ...previousMessages
      .filter((message) => message.id !== userMessage.id)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.text ?? "",
      })),
    ...(memoryContext
      ? [{
        role: "user" as const,
        content: memoryContext,
      }]
      : []),
    {
      role: "user" as const,
      content: deepResearchUserContent(userMessage),
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantTextRaw = "";
      let controllerClosed = false;
      const closeController = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {
          // The client may have disconnected before the final event is written.
        }
      };
      const sendEvent = (event: string, payload: unknown) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`id: ${randomUUID()}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          controllerClosed = true;
        }
      };

      try {
        const result = streamText({
          model: createDeepResearchOpenRouterModel(model, reasoningEffort),
          system: deepResearchSystemPrompt(),
          messages: modelMessages as never,
          tools: createDeepResearchTools(context, toolCalls, { reasoningEffort }),
          stopWhen: stepCountIs(8),
          temperature: 0.2,
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta" && part.text) {
            assistantTextRaw += part.text;
            sendEvent("assistant_delta", { text: part.text });
          }
          if (part.type === "reasoning-delta" && part.text) {
            assistantReasoning += part.text;
            sendEvent("assistant_reasoning", { text: part.text });
          }

          if (part.type === "tool-result" || part.type === "tool-error") {
            const toolCall = mapStreamToolCallToRecord(part);
            if (toolCall) {
              sendEvent("assistant_tool", { toolCall });
            }
          }
        }

        const assistantText = assistantTextRaw.trim().length
          ? assistantTextRaw.trim()
          : `No direct answer was produced. I collected ${toolCalls.length} tool result${toolCalls.length === 1 ? "" : "s"} and no verified conclusion. Try a narrower query.`;
        const reasoning = extractDeepResearchReasoning({
          reasoning: assistantReasoning.length > 0 ? assistantReasoning : undefined,
        });

        const assistantMessage = await store.createDeepResearchMessage({
          chatId: chat.id,
          role: "assistant",
          text: assistantText,
          model,
          reasoning,
          reasoningEffort,
          toolCalls,
        });

        await mirrorDeepResearchConversation(chat.id, userMessage, assistantMessage);
        sendEvent("assistant_final", {
          chat: await store.getDeepResearchChat(chat.id),
          userMessage,
          assistantMessage,
        });
        closeController();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error.";
        if (isClosedControllerError(error)) {
          try {
            const fallback = await generateText({
              model: createDeepResearchOpenRouterModel(model, reasoningEffort),
              system: deepResearchSystemPrompt(),
              messages: modelMessages as never,
              tools: createDeepResearchTools(context, toolCalls, { reasoningEffort }),
              stopWhen: stepCountIs(8),
              temperature: 0.2,
            });
            const fallbackText = fallback.text?.trim() || assistantTextRaw.trim();
            const assistantMessage = await store.createDeepResearchMessage({
              chatId: chat.id,
              role: "assistant",
              text: fallbackText.length
                ? fallbackText
                : "The live research stream closed before a final synthesis was produced. Retry the question or narrow it to one company, component, or supply-chain layer.",
              reasoning: extractDeepResearchReasoning(fallback) ??
                extractDeepResearchReasoning({
                  reasoning: assistantReasoning.length > 0 ? assistantReasoning : undefined,
                }),
              model,
              reasoningEffort,
              toolCalls,
            });

            await mirrorDeepResearchConversation(chat.id, userMessage, assistantMessage);
            sendEvent("assistant_final", {
              chat: await store.getDeepResearchChat(chat.id),
              userMessage,
              assistantMessage,
            });
            closeController();
            return;
          } catch {
            // Fall through to a user-facing failure below.
          }
        }

        const userFacingMessage = isClosedControllerError(error)
          ? "The live research stream closed before a final answer was produced. Retry the question or narrow it to one company, component, or supply-chain layer."
          : message;
        const assistantMessage = await store.createDeepResearchMessage({
          chatId: chat.id,
          role: "assistant",
          text: `Deep Research failed: ${userFacingMessage}`,
          reasoning: `FAILED: ${userFacingMessage}`,
          model,
          reasoningEffort,
          toolCalls,
        });
        sendEvent("assistant_error", {
          chat: await store.getDeepResearchChat(chat.id),
          userMessage,
          assistantMessage,
          message: userFacingMessage,
        });
        closeController();
      }
    },
    cancel() {},
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

function isClosedControllerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /controller is already closed|invalid state/i.test(message);
}

function createDeepResearchOpenRouterModel(
  model: string,
  reasoningEffort?: KairosReasoningEffort,
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for Deep Research.");
  const option = DEEP_RESEARCH_MODELS.find((item) => item.id === model);
  const effectiveReasoningEffort = reasoningEffort ?? option?.reasoningEffort;
  const openrouter = createOpenRouter({
    apiKey,
    appName: process.env.OPENROUTER_APP_TITLE,
    appUrl: process.env.OPENROUTER_HTTP_REFERER,
  });
  return openrouter.chat(model, {
    reasoning: effectiveReasoningEffort ? { effort: effectiveReasoningEffort } : undefined,
  });
}

function resolveDeepResearchReasoningEffort(
  model: string,
  reasoningEffort?: KairosReasoningEffort,
): KairosReasoningEffort | undefined {
  return reasoningEffort ?? DEEP_RESEARCH_MODELS.find((item) => item.id === model)?.reasoningEffort;
}

function deepResearchUserContent(message: DeepResearchMessageRecord) {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: string; filename?: string }
  > = [];
  const text = message.text?.trim();
  if (text) {
    parts.push({ type: "text", text });
  }
  for (const attachment of message.attachments ?? []) {
    parts.push({
      type: "file",
      mediaType: attachment.mimeType,
      filename: attachment.name,
      data: dataUrlToBase64(attachment.dataUrl),
    });
  }
  return parts.length > 0 ? parts : "";
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

async function buildDeepResearchMemoryContext(
  context: DeepResearchContext,
  query: string,
  traces: RouterToolCallRecord[],
): Promise<string | undefined> {
  if (!process.env.SUPERMEMORY_API_KEY) return undefined;
  const startedAt = new Date().toISOString();
  const supermemory = new SupermemoryApi();
  try {
    const [searchOutput, branchProfiles] = await Promise.all([
      supermemory.search({
        q: query,
        limit: 10,
        rerank: true,
        searchMode: "hybrid",
        rewriteQuery: true,
      }),
      loadInformativeBranchProfiles(context, supermemory, query),
    ]);
    const memorySnippets = collectSupermemorySnippets(searchOutput).slice(0, 10);
    const output = {
      memorySnippets,
      branchProfiles: branchProfiles.profiles,
      omittedEmptyProfiles: branchProfiles.omittedEmptyProfiles,
    };
    const summary = [
      `Loaded ${memorySnippets.length} Supermemory snippet${memorySnippets.length === 1 ? "" : "s"}.`,
      `Loaded ${branchProfiles.profiles.length} informative branch profile${branchProfiles.profiles.length === 1 ? "" : "s"}.`,
    ].join(" ");

    traces.push({
      id: randomUUID(),
      name: "supermemory_context",
      status: "succeeded",
      summary,
      input: { query },
      output: compactJson(output),
      createdAt: startedAt,
    });

    if (memorySnippets.length === 0 && branchProfiles.profiles.length === 0) {
      return [
        "Kairos memory context:",
        "No substantive Supermemory or branch-profile context was found for this query.",
        "Use public-source research for public facts, and do not treat empty memory as evidence.",
      ].join("\n");
    }

    return [
      "Kairos memory context:",
      "Use this as prior user/project context, not as public factual evidence. If it conflicts with current public sources, say so.",
      memorySnippets.length > 0
        ? `Supermemory snippets:\n${memorySnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join("\n")}`
        : "Supermemory snippets: none found.",
      branchProfiles.profiles.length > 0
        ? `Informative branch profiles:\n${branchProfiles.profiles.map(formatBranchProfileForPrompt).join("\n")}`
        : "Informative branch profiles: none found.",
    ].join("\n\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    traces.push({
      id: randomUUID(),
      name: "supermemory_context",
      status: "failed",
      summary: message,
      input: { query },
      error: message,
      createdAt: startedAt,
    });
    return undefined;
  }
}

async function loadInformativeBranchProfiles(
  context: DeepResearchContext,
  supermemory: SupermemoryApi,
  query: string,
): Promise<{ profiles: JsonRecord[]; omittedEmptyProfiles: number }> {
  const branches = (await context.store.listBranches()).slice(0, 12);
  const profiles = await Promise.all(
    branches.map(async (branch) => {
      const containerTag = branchProfileMemoryContainerTag(branch);
      try {
        return {
          branchId: branch.id,
          name: branch.name,
          containerTag,
          profile: await supermemory.profile({ containerTag, q: query, threshold: 0.4 }),
        };
      } catch (error) {
        return {
          branchId: branch.id,
          name: branch.name,
          containerTag,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const informativeProfiles = profiles
    .filter(isInformativeBranchProfile)
    .map(compactBranchProfile);
  return {
    profiles: informativeProfiles,
    omittedEmptyProfiles: profiles.length - informativeProfiles.length,
  };
}

function collectSupermemorySnippets(output: unknown): string[] {
  if (!isJsonRecord(output) || !Array.isArray(output.results)) return [];
  const snippets = output.results
    .map((result) => {
      if (!isJsonRecord(result)) return "";
      if (typeof result.memory === "string") return result.memory;
      if (typeof result.summary === "string") return result.summary;
      if (typeof result.content === "string") return result.content;
      return "";
    })
    .map((snippet) => snippet.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((snippet) => !isLowValueBranchProfileSnippet(snippet));
  return [...new Set(snippets)];
}

function branchProfileMemoryContainerTag(branch: BranchRecord): string {
  return getMemoryContainerTag({
    configuredContainerTag: branch.config?.memory?.supermemoryProfileContainerTag,
    scopeId: branch.id,
    prefix: "branch_profile",
  });
}

function formatBranchProfileForPrompt(profile: JsonRecord): string {
  const branchName = typeof profile.name === "string" ? profile.name : "Unnamed branch";
  const branchId = typeof profile.branchId === "string" ? profile.branchId : "unknown";
  const snippets = Array.isArray(profile.snippets)
    ? profile.snippets.filter((snippet): snippet is string => typeof snippet === "string")
    : [];
  return `- ${branchName} (${branchId}): ${snippets.slice(0, 4).join(" | ")}`;
}

function createDeepResearchTools(
  context: DeepResearchContext,
  traces: RouterToolCallRecord[],
  options: { reasoningEffort?: KairosReasoningEffort } = {},
): ToolSet {
  const exa = process.env.EXA_API_KEY ? new ExaApi() : undefined;
  const supermemory = process.env.SUPERMEMORY_API_KEY ? new SupermemoryApi() : undefined;
  const globalMemory = process.env.SUPERMEMORY_API_KEY ? createSupermemoryMemoryApi() : undefined;
  const finnhub = process.env.FINNHUB_API_KEY ? new FinnhubApi() : undefined;

  return {
    supermemory_search_all: tracedTool(traces, "supermemory_search_all", {
      description:
        "Search saved Kairos/Supermemory context across prior conversations, preferences, private notes, remembered companies, laws, branches, and past decisions. Use early when user-specific context could steer the investigation or prevent repeated work. Do not use for fresh public facts, citations, or market data; corroborate public claims with Exa/Finnhub/source tools. Returns memory snippets that should be treated as private context, not public evidence.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Memory query with entity, topic, and context need. Example: user's prior thesis on PLTR government contracts."),
        limit: z.number().int().min(1).max(12).optional().describe("Maximum memory results. Use 4-8 unless the query is broad."),
      }),
      execute: async ({ query, limit }) => {
        if (!supermemory) throw new Error("SUPERMEMORY_API_KEY is not configured.");
        return supermemory.search({
          q: query,
          limit: limit ?? 8,
          rerank: true,
          searchMode: "hybrid",
          rewriteQuery: true,
        });
      },
    }),
    supermemory_branch_profiles: tracedTool(traces, "supermemory_branch_profiles", {
      description:
        "Load Kairos branch/law profiles when saved monitoring context could shape a deep-research answer. Use to identify relevant laws, watched assets, branch-specific false positives, or durable user preferences. Do not use for fresh market facts or citations; pair with public-source tools for public claims. Empty branch-created-only profiles are filtered out.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Branch-profile query with law, asset, or catalyst terms. Example: AI infrastructure supply-chain laws."),
        limitBranches: z.number().int().min(1).max(20).optional().describe("Maximum branches to scan. Use 8-12 for focused research."),
      }),
      execute: async ({ query, limitBranches }) => {
        if (!supermemory) throw new Error("SUPERMEMORY_API_KEY is not configured.");
        const branches = (await context.store.listBranches()).slice(0, limitBranches ?? 12);
        const profiles = await Promise.all(
          branches.map(async (branch) => {
            const containerTag = branchProfileMemoryContainerTag(branch);
            try {
              return {
                branchId: branch.id,
                name: branch.name,
                containerTag,
                profile: await supermemory.profile({ containerTag, q: query, threshold: 0.4 }),
              };
            } catch (error) {
              return {
                branchId: branch.id,
                name: branch.name,
                containerTag,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }),
        );
        const informativeProfiles = profiles
          .filter(isInformativeBranchProfile)
          .map(compactBranchProfile);
        return {
          profiles: informativeProfiles,
          omittedEmptyProfiles: profiles.length - informativeProfiles.length,
        };
      },
    }),
    exa_search: tracedTool(traces, "exa_search", {
      description: "Search current public web/news sources for concrete public facts. Use for companies, markets, supply chains, competitors, products, earnings, filings, catalysts, and recent claims. Do not use for private Kairos memory, specific URL extraction, or broad multi-source synthesis; use the matching tool instead. When the user gives a date window, pass startPublishedDate and endPublishedDate in YYYY-MM-DD format. Returns capped source summaries and URLs; verify dates and source quality.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Focused search query with entity, claim, and timeframe when relevant. Example: NVDA Blackwell supply constraint April 2026."),
        category: z
          .enum(["news", "company", "research paper", "personal site", "financial report", "people"])
          .describe("Optional Exa category. Use news for fresh catalysts, financial report for filings/reports, company for official/company pages.")
          .optional(),
        numResults: z.number().int().min(1).max(10).optional().describe("Number of results. Use 3-6 for focused checks."),
        startPublishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive publication start date in YYYY-MM-DD when freshness matters."),
        endPublishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive publication end date in YYYY-MM-DD when freshness matters."),
      }),
      execute: async ({ query, category, numResults, startPublishedDate, endPublishedDate }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        return exa.search({
          query,
          category: normalizeExaCategory(category),
          numResults,
          startPublishedDate,
          endPublishedDate,
        });
      },
    }),
    exa_research: tracedTool(traces, "exa_research", {
      description: "Run deeper public web research for source-backed synthesis across multiple sources. Prefer for broad market maps, overlooked public companies, supply-chain questions, technical ecosystems, materiality checks, and cited synthesis. Do not use when a focused search or source read is enough. Returns synthesized public evidence with citations where available, not a trade recommendation.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Research question with scope and desired comparison/materiality angle. Example: Which public companies benefit if US grid interconnect demand accelerates?"),
      }),
      execute: async ({ query }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        const result = await exa.deepResearch({
          query,
          outputSchema: {
            type: "text",
            description: "Market-relevant synthesis with material facts, dates, uncertainty, and source-backed claims.",
          },
          contents: {
            highlights: {
              query: "material facts, dates, numbers, and management quotes",
              maxCharacters: 2000,
            },
            text: {
              maxCharacters: 10_000,
            },
            summary: {
              query:
                "Summarize the highest-confidence material claims and uncertainty.",
            },
          },
          numResults: 6,
        });
        return {
          ...result,
          output: {
            ...result.output,
            content: summarizeExaSearchOutput(result),
          },
        };
      },
    }),
    exa_contents: tracedTool(traces, "exa_contents", {
      description: "Read and summarize specific URLs. Use when the exact source text matters, such as filings, press releases, articles, or user-supplied links. Do not use for source discovery or broad synthesis without URLs. Returns extracted text/summaries and URL metadata; prefer it over headline-only evidence when facts conflict.",
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(5).describe("Specific URLs to read. Use no more than five at once."),
        maxCharacters: z.number().int().min(500).max(20000).optional().describe("Maximum extracted characters per request. Use 4000-10000 unless long filings are required."),
      }),
      execute: async ({ urls, maxCharacters }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        return exa.contents({ urls, maxCharacters });
      },
    }),
    information_agent: tracedTool(traces, "information_agent", {
      description: "Delegate a focused market-context lookup to the Kairos information workflow. Use when the deep-research answer needs a compact cited pass across Exa, Finnhub, and Supermemory context. Do not use for final conclusions, trade execution, or questions already answered by gathered sources. Returns concise evidence synthesis with citations and uncertainty notes.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Focused market-context request with ticker/entity, catalyst, and what to verify. Example: Verify whether PLTR has a new material federal contract this week."),
      }),
      execute: async ({ query }) => {
        const modelOverrides = options.reasoningEffort
          ? {
            informationPlanner: { reasoningEffort: options.reasoningEffort },
            informationSynthesis: { reasoningEffort: options.reasoningEffort },
          }
          : undefined;
        return runInformationAgent(query, {
          exa,
          finnhub,
          memory: globalMemory,
          supermemory: globalMemory,
          plannerModel: structuredModelProvider(createOpenRouterChatModelForRole("informationPlanner", {
            modelOverrides,
          })),
          synthesisModel: structuredModelProvider(createOpenRouterChatModelForRole("informationSynthesis", {
            modelOverrides,
          })),
          maxToolCalls: 8,
          finnhubPremiumAccess: true,
          allowDeterministicFallback: false,
        });
      },
    }),
  };
}

function structuredModelProvider(model: ReturnType<typeof createOpenRouterChatModelForRole>) {
  return {
    withStructuredOutput: <T>(schema: unknown) => ({
      invoke: (input: unknown) =>
        model.withStructuredOutput(schema as Record<string, unknown>).invoke(input as never) as Promise<T>,
    }),
  };
}

function tracedTool<TInput extends z.ZodTypeAny, TOutput>(traces: RouterToolCallRecord[], name: string, config: {
  description: string;
  inputSchema: TInput;
  execute: (input: z.infer<TInput>) => Promise<TOutput>;
}) {
  return tool({
    description: config.description,
    inputSchema: config.inputSchema,
    execute: async (input: z.infer<TInput>) => {
      const startedAt = new Date().toISOString();
      try {
        const output = await config.execute(input);
        traces.push({
          id: randomUUID(),
          name,
          status: "succeeded",
          summary: compactToolSummary(output),
          input: compactJson(input),
          output: compactJson(output),
          createdAt: startedAt,
        });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traces.push({
          id: randomUUID(),
          name,
          status: "failed",
          summary: message,
          input: compactJson(input),
          error: message,
          createdAt: startedAt,
        });
        throw error;
      }
    },
  } as never);
}

function normalizeExaCategory(
  category?:
    | "news"
    | "company"
    | "research paper"
    | "personal site"
    | "financial report"
    | "people",
): "news" | "company" | "research paper" | "personal site" | "financial report" | "people" | undefined {
  return category;
}

function summarizeExaSearchOutput(result: Awaited<ReturnType<ExaApi["deepResearch"]>>) {
  if (typeof result.output?.content === "string") {
    const text = result.output.content.trim();
    if (text.length > 0) {
      return text;
    }
  }
  if (result.output?.content && typeof result.output.content === "object") {
    const text = JSON.stringify(result.output.content).trim();
    if (text.length > 0) {
      return text;
    }
  }

  const firstResult = result.results[0];
  if (firstResult?.summary) return firstResult.summary;
  if (firstResult?.highlights?.length) return firstResult.highlights.join("\n");
  return "No synthesis output was produced for this deep research query.";
}

function deepResearchSystemPrompt(now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  return [
    "You are Kairos Deep Research: isolated market, product, technical, and memory-backed investigation agent.",
    `Current date: ${today}. Resolve relative windows like "last 30 days" from this date; do not infer the date from search results.`,
    "When configured, Supermemory preflight is important user/project context for follow-up research.",
    "Query Supermemory again when prior user context, remembered companies, saved notes, laws, branches, or decisions could change the answer.",
    "For public-market/company, supply-chain, technical-ecosystem, product, current-event, or investment-research questions, use public tools first: exa_research, exa_search, exa_contents, information_agent.",
    "Corroborate public factual claims with public sources even when memory gives leads.",
    "Use branch profiles when saved branch/law context can shape investigation.",
    "If memory or branch profiles return no substance, ignore them and continue source-backed public research.",
    "For market claims, separate evidence, belief update, and conclusion; cite tool-provided URLs and mark uncertainty.",
    "Do not place live trades, submit broker orders, or claim execution authority.",
  ].join("\n");
}

function resolveDeepResearchModel(model: string | undefined): string {
  if (!model) return DEEP_RESEARCH_DEFAULT_MODEL;

  if (DEEP_RESEARCH_MODELS.some((option) => option.id === model)) {
    return model;
  }

  throw new Error(`Selected model is unavailable: ${model}`);
}

async function generateDeepResearchTitle(text: string): Promise<string | undefined> {
  if (!process.env.OPENROUTER_API_KEY) return buildTitle(text);
  try {
    const result = await generateText({
      model: createDeepResearchOpenRouterModel("google/gemma-4-31b-it"),
      system: "Name this research chat. Return 2-5 plain words. No punctuation.",
      prompt: text.slice(0, 1200),
      temperature: 0,
    });
    return cleanTitle(result.text) ?? buildTitle(text);
  } catch {
    return buildTitle(text);
  }
}

async function mirrorDeepResearchConversation(
  chatId: string,
  userMessage: DeepResearchMessageRecord,
  assistantMessage: DeepResearchMessageRecord,
): Promise<void> {
  if (!process.env.SUPERMEMORY_API_KEY) return;
  try {
    await new SupermemoryApi().writeConversation({
      containerTag: "kairos_deep_research",
      customId: `kairos:deep_research:${chatId}:${assistantMessage.id}`,
      messages: [
        { role: "user", content: userMessage.text ?? "", timestamp: userMessage.createdAt },
        { role: "assistant", content: assistantMessage.text ?? "", timestamp: assistantMessage.createdAt },
      ],
      metadata: {
        type: "deep_research_conversation",
        chat_id: chatId,
        image_count: userMessage.attachments?.length ?? 0,
        ...(assistantMessage.model ? { model: assistantMessage.model } : {}),
      },
    });
  } catch {
    // Memory writes should not block the local chat transcript.
  }
}

function buildTitle(text: string): string | undefined {
  const title = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}...` : title;
}

function cleanTitle(value: string | undefined): string | undefined {
  const title = value?.replace(/^["'`]+|["'`.]+$/g, "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  if (/^#|[*_`[\]]/.test(title) || /evidence|conclusion|summary/i.test(title)) {
    return undefined;
  }
  return title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title;
}

function compactToolSummary(output: unknown): string {
  if (typeof output === "string") return output.slice(0, 240);
  if (isJsonRecord(output) && typeof output.summary === "string") return output.summary.slice(0, 240);
  if (isJsonRecord(output) && typeof output.answer === "string") return output.answer.slice(0, 240);
  if (isJsonRecord(output) && Array.isArray(output.results)) {
    const total = typeof output.total === "number" ? output.total : output.results.length;
    return total === 0
      ? "No matching memory or source results found."
      : `Found ${total} result${total === 1 ? "" : "s"}.`;
  }
  if (isJsonRecord(output) && Array.isArray(output.profiles)) {
    const count = output.profiles.length;
    return `Loaded ${count} branch profile${count === 1 ? "" : "s"}.`;
  }
  if (
    isJsonRecord(output) &&
    isJsonRecord(output.output) &&
    typeof output.output.content === "string"
  ) {
    return output.output.content.slice(0, 240);
  }
  return "Tool completed.";
}

function isInformativeBranchProfile(profile: unknown): boolean {
  return collectBranchProfileSnippets(profile).length > 0;
}

function compactBranchProfile(profile: unknown): JsonRecord {
  if (!isJsonRecord(profile)) return {};
  const compact: JsonRecord = {
    branchId: profile.branchId,
    name: profile.name,
    snippets: collectBranchProfileSnippets(profile).slice(0, 8),
  };
  if (typeof profile.error === "string") compact.error = profile.error;
  return compact;
}

function collectBranchProfileSnippets(profileRecord: unknown): string[] {
  if (!isJsonRecord(profileRecord)) return [];
  const profile = profileRecord.profile;
  if (!isJsonRecord(profile)) return [];
  const snippets: string[] = [];
  const profileContent = profile.profile;
  if (isJsonRecord(profileContent)) {
    for (const key of ["static", "dynamic"]) {
      const values = profileContent[key];
      if (Array.isArray(values)) {
        for (const value of values) {
          if (typeof value === "string") snippets.push(value);
        }
      }
    }
  }

  const searchResults = profile.searchResults;
  if (isJsonRecord(searchResults) && Array.isArray(searchResults.results)) {
    for (const result of searchResults.results) {
      if (isJsonRecord(result) && typeof result.memory === "string") {
        snippets.push(result.memory);
      }
    }
  }

  return [...new Set(snippets.map((snippet) => snippet.trim()).filter(Boolean))]
    .filter((snippet) => !isLowValueBranchProfileSnippet(snippet));
}

function isLowValueBranchProfileSnippet(snippet: string): boolean {
  return /^Kairos branch\.branch\.created:/i.test(snippet) ||
    /^branch\.created\b/i.test(snippet);
}

function extractDeepResearchReasoning(result: { reasoning?: unknown } | undefined): string | undefined {
  return compactReasoningLines((result?.reasoning as unknown) ?? undefined);
}

function compactReasoningLines(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 8000) : undefined;
  }

  if (Array.isArray(value)) {
    const lines = value
      .map((entry) =>
        typeof entry === "string"
          ? entry.trim()
          : isJsonRecord(entry) && typeof entry.text === "string"
            ? entry.text.trim()
            : isJsonRecord(entry) && typeof entry.summary === "string"
              ? entry.summary.trim()
              : JSON.stringify(entry),
      )
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  if (isJsonRecord(value)) {
    if (typeof value.reasoning === "string") {
      const text = value.reasoning.trim();
      if (text.length > 0) return text.slice(0, 8000);
    }
    if (Array.isArray(value.steps)) {
      return compactReasoningLines(value.steps);
    }
    try {
      const compact = JSON.stringify(value, null, 2);
      return compact.length > 0 ? compact.slice(0, 8000) : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function mapStreamToolCallToRecord(part: TextStreamPart<ToolSet>): RouterToolCallRecord | undefined {
  const typedPart = part as {
    toolName?: unknown;
    toolCallId?: unknown;
    input?: unknown;
    output?: unknown;
    error?: unknown;
  };

  const toolName = typeof typedPart.toolName === "string" ? typedPart.toolName : undefined;
  const toolCallId = typeof typedPart.toolCallId === "string" ? typedPart.toolCallId : undefined;
  if (!toolName || !toolCallId) return undefined;

  if (part.type === "tool-result") {
    return {
      id: toolCallId,
      name: toolName,
      status: "succeeded",
      summary: compactToolSummary(typedPart.output),
      input: compactJson(typedPart.input),
      output: compactJson(typedPart.output),
      createdAt: new Date().toISOString(),
    };
  }

  if (part.type === "tool-error") {
    return {
      id: toolCallId,
      name: toolName,
      status: "failed",
      summary:
        typedPart.error instanceof Error
          ? typedPart.error.message
          : compactToolSummary(typedPart.error),
      input: compactJson(typedPart.input),
      error: typedPart.error instanceof Error ? typedPart.error.message : String(typedPart.error ?? ""),
      createdAt: new Date().toISOString(),
    };
  }

  return undefined;
}

function compactJson(value: unknown): JsonRecord | undefined {
  if (!isJsonRecord(value)) return undefined;
  const seen = new Map<unknown, unknown>();
  return sanitizeForTrace(value, seen) as JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeForTrace(
  value: unknown,
  seen: Map<unknown, unknown>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 2400 ? `${value.slice(0, 2395)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") return undefined;
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.set(value, value);
    if (Array.isArray(value)) {
      return value
        .map((item) => sanitizeForTrace(item, seen))
        .filter((item) => item !== undefined);
    }

    const output: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeForTrace(item, seen);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }

  return String(value);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await readTextWithLimit(request, maxJsonBodyBytes());
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError(maxBytes);
    }
    output += decoder.decode(chunk.value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

function maxJsonBodyBytes(): number {
  const configured = Number(process.env.KAIROS_MAX_JSON_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_JSON_BODY_BYTES;
}

function shouldEnqueueDeepResearchJob(): boolean {
  return parseEnabledFlag(process.env.KAIROS_ENQUEUE_AGENT_JOBS) ??
    (process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.KAIROS_DEPLOYMENT_ENV === "production");
}

function parseEnabledFlag(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  return undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(redactSensitiveResponseValues(body)), {
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
  const allowedOrigin =
    process.env.KAIROS_CORS_ORIGIN ??
    process.env.VITE_KAIROS_APP_ORIGIN ??
    "http://127.0.0.1:5173";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": [
      "authorization",
      "content-type",
      IDEMPOTENCY_KEY_HEADER,
      LOCAL_REQUEST_HEADER,
      LOCAL_TOKEN_HEADER,
      REQUEST_ID_HEADER,
    ].join(","),
  };
}

function redactSensitiveResponseValues(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveResponseValues(item, seen));
  }
  if (!isJsonRecord(value)) return value;
  if (seen.has(value)) return "[redacted:circular]";
  seen.add(value);
  const redacted = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_RESPONSE_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redactSensitiveResponseValues(item, seen),
    ]),
  );
  seen.delete(value);
  return redacted;
}
