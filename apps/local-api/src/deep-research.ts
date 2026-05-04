import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs, tool, type ToolSet } from "ai";
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
import type { BranchRecord, JsonRecord, KairosLocalStore, RouterToolCallRecord } from "./store.js";

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

type DeepResearchContext = {
  store: KairosLocalStore;
};

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

const chatCreateSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

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

    const store = new DeepResearchFileStore();
    if (segments.length === 2 && segments[1] === "chats") {
      if (request.method === "GET") return json({ chats: await store.listChats() });
      if (request.method === "POST") {
        return json({ chat: await store.createChat(chatCreateSchema.parse(await readJson(request))) }, 201);
      }
    }

    if (segments.length === 4 && segments[1] === "chats" && segments[3] === "messages") {
      const chatId = segments[2];
      const chat = await store.getChat(chatId);
      if (!chat) return json({ error: "not_found", message: "Deep Research chat not found." }, 404);
      if (request.method === "GET") return json({ messages: await store.listMessages(chatId) });
      if (request.method === "POST") {
        const input = messageCreateSchema.parse(await readJson(request));
        if (!input.text.trim() && input.attachments.length === 0) {
          return json({ error: "bad_request", message: "Deep Research message is empty." }, 400);
        }
        return runDeepResearchMessage(context, store, chat, input);
      }
    }

    return json({ error: "not_found", message: "Deep Research route not found." }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: "bad_request", issues: error.issues }, 400);
    }
    return json({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error.",
    }, 500);
  }
}

async function runDeepResearchMessage(
  context: DeepResearchContext,
  store: DeepResearchFileStore,
  chat: DeepResearchChatRecord,
  input: z.infer<typeof messageCreateSchema>,
): Promise<Response> {
  const model = resolveDeepResearchModel(input.model);
  const reasoningEffort = input.reasoningEffort;
  const chatTitle = chat.title ?? await generateDeepResearchTitle(input.text);
  const userMessage = await store.createMessage({
    chatId: chat.id,
    role: "user",
    text: input.text.trim(),
    attachments: input.attachments,
    chatTitle,
  });
  const previousMessages = await store.listMessages(chat.id);
  const toolCalls: RouterToolCallRecord[] = [];
  const modelMessages = [
    ...previousMessages
      .filter((message) => message.id !== userMessage.id)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.text ?? "",
      })),
    {
      role: "user" as const,
      content: deepResearchUserContent(userMessage),
    },
  ];

  try {
    const result = await generateText({
      model: createDeepResearchOpenRouterModel(model, reasoningEffort),
      system: deepResearchSystemPrompt(),
      messages: modelMessages as never,
      tools: createDeepResearchTools(context, toolCalls),
      stopWhen: stepCountIs(8),
      temperature: 0.2,
    });
    const assistantText = result.text?.trim();
    const reasoning = extractDeepResearchReasoning(result);
    const assistantMessage = await store.createMessage({
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
      chat: await store.getChat(chat.id),
      userMessage,
      assistantMessage,
      toolCalls,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
  const assistantMessage = await store.createMessage({
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

function createDeepResearchTools(
  context: DeepResearchContext,
  traces: RouterToolCallRecord[],
): ToolSet {
  const exa = process.env.EXA_API_KEY ? new ExaApi() : undefined;
  const supermemory = process.env.SUPERMEMORY_API_KEY ? new SupermemoryApi() : undefined;
  const globalMemory = process.env.SUPERMEMORY_API_KEY ? createSupermemoryMemoryApi() : undefined;
  const finnhub = process.env.FINNHUB_API_KEY ? new FinnhubApi() : undefined;

  return {
    supermemory_search_all: tracedTool(traces, "supermemory_search_all", {
      description:
        "Search memory for relevant prior context and observations.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(12).optional(),
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
        "Load branch summaries to keep the investigation aligned to active laws.",
      inputSchema: z.object({
        query: z.string().min(1),
        limitBranches: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, limitBranches }) => {
        if (!supermemory) throw new Error("SUPERMEMORY_API_KEY is not configured.");
        const branches = (await context.store.listBranches()).slice(0, limitBranches ?? 12);
        const profiles = await Promise.all(
          branches.map(async (branch) => {
            const containerTag = getMemoryContainerTag({
              scopeId: branch.id,
              prefix: "branch_profile",
            });
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
        return { profiles };
      },
    }),
    exa_search: tracedTool(traces, "exa_search", {
      description: "Search current web and news sources.",
      inputSchema: z.object({
        query: z.string().min(1),
        category: z
          .enum(["news", "company", "research paper", "pdf", "personal site", "financial report", "people"])
          .optional(),
        numResults: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ query, category, numResults }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        return exa.search({
          query,
          category: normalizeExaCategory(category),
          numResults,
        });
      },
    }),
    exa_research: tracedTool(traces, "exa_research", {
      description: "Run a deeper research pass for a source-backed answer.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        return exa.answer({ query, text: true });
      },
    }),
    exa_contents: tracedTool(traces, "exa_contents", {
      description: "Read and summarize specific URLs.",
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(5),
        maxCharacters: z.number().int().min(500).max(20000).optional(),
      }),
      execute: async ({ urls, maxCharacters }) => {
        if (!exa) throw new Error("EXA_API_KEY is not configured.");
        return exa.contents({ urls, maxCharacters });
      },
    }),
    information_agent: tracedTool(traces, "information_agent", {
      description: "Run a broader investigation pass using available system context.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        return runInformationAgent(query, {
          exa,
          finnhub,
          memory: globalMemory,
          supermemory: globalMemory,
          plannerModel: structuredModelProvider(createOpenRouterChatModelForRole("informationPlanner")),
          synthesisModel: structuredModelProvider(createOpenRouterChatModelForRole("informationSynthesis")),
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
    | "pdf"
    | "personal site"
    | "financial report"
    | "people",
): "news" | "company" | "research paper" | "pdf" | "personal site" | "financial report" | "people" | undefined {
  return category;
}

function deepResearchSystemPrompt(): string {
  return [
    "You are Kairos Deep Research, an isolated research agent for market, product, technical, and memory-backed investigation.",
    "Use tools aggressively when facts could be stale, source-dependent, or memory-dependent.",
    "Supermemory is available across all accessible user memory. Search it before answering questions about user preferences, prior context, laws, branches, or past decisions.",
    "For market claims, separate evidence, belief update, and conclusion. Cite URLs and memory/tool evidence when available.",
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

class DeepResearchFileStore {
  private readonly rootDir =
    process.env.KAIROS_DEEP_RESEARCH_DATA_DIR ??
    join(process.cwd(), "data", "runtime", "deep-research");

  async listChats(): Promise<DeepResearchChatRecord[]> {
    const fileNames = await this.listJsonFiles(join(this.rootDir, "chats"));
    const chats = await Promise.all(
      fileNames.map((fileName) =>
        this.readJson<DeepResearchChatRecord>(join(this.rootDir, "chats", fileName)),
      ),
    );
    return chats
      .filter((chat): chat is DeepResearchChatRecord => Boolean(chat))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async createChat(input: { id?: string; title?: string } = {}): Promise<DeepResearchChatRecord> {
    const now = new Date().toISOString();
    const chat = {
      id: input.id ?? randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeJson(this.chatPath(chat.id), chat);
    return chat;
  }

  async getChat(id: string): Promise<DeepResearchChatRecord | undefined> {
    return this.readJson<DeepResearchChatRecord>(this.chatPath(id));
  }

  async listMessages(chatId: string): Promise<DeepResearchMessageRecord[]> {
    try {
      const text = await readFile(this.messagesPath(chatId), "utf8");
      return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as DeepResearchMessageRecord);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
  }

  async createMessage(input: {
    chatId: string;
    role: "user" | "assistant";
    text?: string;
    chatTitle?: string;
    model?: string;
    reasoning?: string;
    reasoningEffort?: KairosReasoningEffort;
    attachments?: DeepResearchImageAttachment[];
    toolCalls?: RouterToolCallRecord[];
  }): Promise<DeepResearchMessageRecord> {
    const message = {
      id: randomUUID(),
      chatId: input.chatId,
      role: input.role,
      text: input.text,
      model: input.model,
      reasoning: input.reasoning,
      reasoningEffort: input.reasoningEffort,
      attachments: input.attachments,
      toolCalls: input.toolCalls,
      createdAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.messagesPath(input.chatId)), { recursive: true });
    await writeFile(this.messagesPath(input.chatId), `${JSON.stringify(message)}\n`, { flag: "a" });
    const chat = await this.getChat(input.chatId);
    if (chat) {
      await this.writeJson(this.chatPath(input.chatId), {
        ...chat,
        title: chat.title ?? input.chatTitle ?? buildTitle(input.text ?? ""),
        updatedAt: message.createdAt,
      });
    }
    return message;
  }

  private chatPath(chatId: string): string {
    return join(this.rootDir, "chats", `${encodeFileSegment(chatId)}.json`);
  }

  private messagesPath(chatId: string): string {
    return join(this.rootDir, "messages", `${encodeFileSegment(chatId)}.jsonl`);
  }

  private async listJsonFiles(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((fileName) => fileName.endsWith(".json"));
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
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
  return title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title;
}

function compactToolSummary(output: unknown): string {
  if (typeof output === "string") return output.slice(0, 240);
  if (isJsonRecord(output) && typeof output.summary === "string") return output.summary.slice(0, 240);
  if (isJsonRecord(output) && typeof output.answer === "string") return output.answer.slice(0, 240);
  return "Tool completed.";
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

function isNotFoundError(error: unknown): boolean {
  return isJsonRecord(error) && error.code === "ENOENT";
}

function encodeFileSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
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
