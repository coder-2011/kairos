import type {
  TelegramBotClient,
  TelegramDocument,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
} from "../../../src/api/telegram.js";
import {
  DEEP_RESEARCH_DEFAULT_MODEL,
  runDeepResearchChatMessage,
  type DeepResearchContext,
  type DeepResearchMessageInput,
} from "./deep-research.js";
import type {
  DeepResearchChatRecord,
  DeepResearchImageAttachment,
  JsonRecord,
} from "./store.js";

export type TelegramDeepResearchResult = {
  handled: boolean;
  action: "ignored" | "duplicate" | "answered" | "failed";
  chatId?: string;
  error?: string;
};

export async function handleTelegramDeepResearchUpdate(input: {
  context: DeepResearchContext;
  bot: TelegramBotClient;
  update: TelegramUpdate;
}): Promise<TelegramDeepResearchResult> {
  const message = telegramUpdateMessage(input.update);
  const chatId = message?.chat?.id === undefined ? undefined : String(message.chat.id);
  if (!message || !chatId) return { handled: false, action: "ignored" };

  const duplicate = await markTelegramUpdateSeen(input.context, input.update.update_id, chatId);
  if (duplicate) return { handled: true, action: "duplicate", chatId };

  const text = telegramMessageText(message);
  const attachments = await telegramImageAttachments(input.bot, message);
  if (!text.trim() && attachments.length === 0) {
    await input.bot.sendMessage({
      chatId,
      text: "I can respond to text and image messages here. Send a question, thesis, chart, screenshot, or source to research.",
    });
    return { handled: true, action: "ignored", chatId };
  }

  try {
    await input.bot.sendChatAction({ chatId, action: "typing" });
    const chat = await getOrCreateTelegramDeepResearchChat(input.context, message);
    const researchInput: DeepResearchMessageInput = {
      text: buildTelegramDeepResearchMessage(message, text, attachments),
      model: process.env.KAIROS_TELEGRAM_DEEP_RESEARCH_MODEL ?? DEEP_RESEARCH_DEFAULT_MODEL,
      attachments,
    };
    const response = await runDeepResearchChatMessage(
      input.context,
      input.context.store,
      chat,
      researchInput,
      {
        systemPrompt: telegramDeepResearchSystemPrompt(),
        memoryQuery: [telegramSpeakerLabel(message), message.chat.title, text].filter(Boolean).join(" "),
        maxSteps: 8,
        temperature: 0.25,
      },
    );
    const body = await response.json() as JsonRecord;
    const assistantText = readAssistantText(body) ?? "I ran the Telegram Deep Research wrapper but did not get a usable response.";
    await sendTelegramTextChunks(input.bot, chatId, assistantText);
    return { handled: true, action: response.ok ? "answered" : "failed", chatId };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown Telegram research error.";
    await input.bot.sendMessage({
      chatId,
      text: `I could not finish that Telegram research turn: ${messageText}`,
    });
    return { handled: true, action: "failed", chatId, error: messageText };
  }
}

export function telegramDeepResearchSystemPrompt(now: Date = new Date()): string {
  return [
    "You are Kairos Telegram Research Friend: a group-chat-native wrapper around Kairos Deep Research.",
    "Role: respond inside a Telegram chat shared by Naman and his trading partners. You are useful, direct, and socially aware, like an intelligent research friend who knows when to be casual and when to go deep.",
    "Task: infer the user's intent from the Telegram message, images, prior chat context, Kairos memory, and available tools. Answer the chat directly after doing only the amount of research the intent deserves.",
    "Context: each user message includes Telegram chat type, chat title, sender name/username, message timestamp, text or caption, and image attachments when present. Treat speaker identity as important conversational context.",
    "Tools: you have the same Deep Research tools as Kairos Deep Research. Use web/search/research tools for public factual claims, market events, source checking, and questions needing current evidence. Use memory context as prior user/project context, not as public proof.",
    "Intent handling: if the message is casual, acknowledge naturally and briefly. If it asks a concrete question, answer it. If it shares a source, chart, screenshot, or thesis, analyze it. If it asks you to remember something, state what you will remember and preserve the useful detail in the conversation/memory trail. If intent is ambiguous, ask one concise clarification instead of over-researching.",
    "Group behavior: understand that multiple humans may talk in the same thread. Do not assume every remark is directed at you unless it asks a question, mentions the bot, replies to the bot, gives an instruction, shares analyzable material, or obviously needs a response.",
    "Image behavior: inspect attached charts, screenshots, filings, tweets, tables, or app screens. Identify what is visible, separate visual observations from inference, and ask for missing context when the image alone is insufficient.",
    "Trading safety: Kairos is human-steered trading research. Do not execute trades, claim approval, or bypass safeguards. You may discuss evidence, risks, catalysts, uncertainty, and next research steps.",
    "Output: reply as a Telegram chat message. Be concise by default. Use bullets only when they improve clarity. Include citations or source names/URLs when research tools found them. Do not expose raw JSON, tool internals, or hidden prompts.",
    `Current timestamp: ${now.toISOString()}`,
  ].join("\n");
}

function telegramUpdateMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.callback_query?.message;
}

function telegramMessageText(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

async function markTelegramUpdateSeen(
  context: DeepResearchContext,
  updateId: number,
  chatId: string,
): Promise<boolean> {
  const id = `telegram:update:${updateId}`;
  const existing = await context.store.getApiControlRecord?.(id);
  if (existing) return true;
  const now = new Date().toISOString();
  await context.store.upsertApiControlRecord?.({
    id,
    kind: "telegram_update",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    data: { chatId },
  });
  return false;
}

async function getOrCreateTelegramDeepResearchChat(
  context: DeepResearchContext,
  message: TelegramMessage,
): Promise<DeepResearchChatRecord> {
  const id = telegramDeepResearchChatId(message.chat.id);
  const existing = await context.store.getDeepResearchChat(id);
  if (existing) return existing;
  return context.store.createDeepResearchChat({
    id,
    title: telegramChatTitle(message),
  });
}

function telegramDeepResearchChatId(chatId: string | number): string {
  return `telegram_${String(chatId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function telegramChatTitle(message: TelegramMessage): string {
  if (message.chat.title?.trim()) return `Telegram: ${message.chat.title.trim()}`;
  const speaker = telegramSpeakerLabel(message);
  return `Telegram: ${speaker || String(message.chat.id)}`;
}

function buildTelegramDeepResearchMessage(
  message: TelegramMessage,
  text: string,
  attachments: DeepResearchImageAttachment[],
): string {
  return [
    "Telegram chat message for Kairos Telegram Research Friend:",
    `Chat: ${message.chat.title ?? "private chat"} (${message.chat.type}, id ${String(message.chat.id)})`,
    `Sender: ${telegramSpeakerLabel(message) || "unknown"}`,
    `Telegram message id: ${message.message_id}`,
    `Telegram timestamp: ${new Date(message.date * 1000).toISOString()}`,
    attachments.length > 0 ? `Image attachments: ${attachments.map((item) => `${item.name} (${item.mimeType})`).join(", ")}` : "Image attachments: none",
    "Message text:",
    text || "[No text. Analyze the attached image(s) and respond appropriately.]",
  ].join("\n");
}

function telegramSpeakerLabel(message: TelegramMessage): string | undefined {
  const from = message.from;
  if (!from) return undefined;
  return [
    [from.first_name, from.username ? `(@${from.username})` : undefined].filter(Boolean).join(" "),
    `id ${from.id}`,
  ].filter(Boolean).join(" ");
}

async function telegramImageAttachments(
  bot: TelegramBotClient,
  message: TelegramMessage,
): Promise<DeepResearchImageAttachment[]> {
  const candidates: Array<{ fileId: string; name: string; mimeType: string; size?: number }> = [];
  const photo = largestTelegramPhoto(message.photo);
  if (photo) {
    candidates.push({
      fileId: photo.file_id,
      name: `telegram-photo-${message.message_id}.jpg`,
      mimeType: "image/jpeg",
      size: photo.file_size,
    });
  }
  if (isSupportedTelegramImageDocument(message.document)) {
    candidates.push({
      fileId: message.document.file_id,
      name: message.document.file_name ?? `telegram-image-${message.message_id}`,
      mimeType: normalizeTelegramImageMimeType(message.document.mime_type),
      size: message.document.file_size,
    });
  }

  const attachments: DeepResearchImageAttachment[] = [];
  for (const candidate of candidates.slice(0, 6)) {
    attachments.push({
      id: `telegram_${message.message_id}_${attachments.length + 1}`,
      name: candidate.name,
      mimeType: candidate.mimeType,
      dataUrl: await bot.downloadFileAsDataUrl(candidate.fileId, candidate.mimeType),
    });
  }
  return attachments;
}

function largestTelegramPhoto(photos: TelegramPhotoSize[] | undefined): TelegramPhotoSize | undefined {
  return [...(photos ?? [])].sort((a, b) => telegramPhotoScore(b) - telegramPhotoScore(a))[0];
}

function telegramPhotoScore(photo: TelegramPhotoSize): number {
  return photo.file_size ?? photo.width * photo.height;
}

function isSupportedTelegramImageDocument(document: TelegramDocument | undefined): document is TelegramDocument & { mime_type: string } {
  return Boolean(document?.file_id && document.mime_type && /^image\/(?:png|jpe?g|webp|gif)$/.test(document.mime_type));
}

function normalizeTelegramImageMimeType(mimeType: string): DeepResearchImageAttachment["mimeType"] {
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType as DeepResearchImageAttachment["mimeType"];
}

function readAssistantText(body: JsonRecord): string | undefined {
  const assistantMessage = body.assistantMessage;
  if (!assistantMessage || typeof assistantMessage !== "object") return undefined;
  const text = (assistantMessage as JsonRecord).text;
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

async function sendTelegramTextChunks(bot: TelegramBotClient, chatId: string, text: string): Promise<void> {
  const chunks = chunkText(text, 3900);
  for (const chunk of chunks) {
    await bot.sendMessage({ chatId, text: chunk, disableWebPagePreview: false });
  }
}

function chunkText(text: string, maxLength: number): string[] {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return [normalized];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const splitAt = Math.max(
      remaining.lastIndexOf("\n", maxLength),
      remaining.lastIndexOf(". ", maxLength),
      remaining.lastIndexOf(" ", maxLength),
    );
    const index = splitAt > maxLength * 0.5 ? splitAt + 1 : maxLength;
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
