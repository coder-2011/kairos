import { recordProviderUsage } from "../global/usage.js";

export type TelegramBotClientOptions = {
  token?: string;
  defaultChatId?: string;
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type TelegramSendMessageInput = {
  chatId?: string;
  text: string;
  parseMode?: "MarkdownV2" | "HTML" | "Markdown";
  disableWebPagePreview?: boolean;
  replyMarkup?: unknown;
};

export type TelegramSendMessageResult = {
  messageId: number;
  chatId: string;
  date?: number;
};

export type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramChat = {
  id: number | string;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  from?: TelegramUser;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
};

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string; parameters?: { retry_after?: number; migrate_to_chat_id?: number } };

export class TelegramBotApiError extends Error {
  readonly errorCode?: number;
  readonly retryAfter?: number;
  readonly migrateToChatId?: number;

  constructor(message: string, options: { errorCode?: number; retryAfter?: number; migrateToChatId?: number } = {}) {
    super(message);
    this.name = "TelegramBotApiError";
    this.errorCode = options.errorCode;
    this.retryAfter = options.retryAfter;
    this.migrateToChatId = options.migrateToChatId;
  }
}

export class TelegramBotClient {
  private readonly token: string;
  private readonly defaultChatId: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramBotClientOptions = {}) {
    this.token = options.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.defaultChatId = options.defaultChatId ?? process.env.TELEGRAM_CHAT_ID ?? process.env.KAIROS_TELEGRAM_CHAT_ID ?? "";
    this.webhookSecret = options.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.KAIROS_TELEGRAM_WEBHOOK_SECRET ?? "";
    this.baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.token);
  }

  get canSendToDefaultChat(): boolean {
    return Boolean(this.token && this.defaultChatId);
  }

  get configuredWebhookSecret(): string | undefined {
    return this.webhookSecret || undefined;
  }

  validateBotConfigured(): void {
    if (!this.token) {
      throw new Error("Telegram bot is not configured. Missing: TELEGRAM_BOT_TOKEN.");
    }
  }

  validateSendConfigured(chatId?: string): void {
    this.validateBotConfigured();
    if (!(chatId || this.defaultChatId)) {
      throw new Error("Telegram notifications are not configured. Missing: TELEGRAM_CHAT_ID or an active Telegram /start binding.");
    }
  }

  verifyWebhookSecret(headerValue: string | null): boolean {
    return !this.webhookSecret || headerValue === this.webhookSecret;
  }

  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe", {});
  }

  async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult> {
    const chatId = input.chatId ?? this.defaultChatId;
    this.validateSendConfigured(chatId);
    const result = await this.request<{ message_id: number; date?: number; chat: TelegramChat }>("sendMessage", {
      chat_id: chatId,
      text: constrainTelegramText(input.text),
      ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      ...(input.disableWebPagePreview === undefined ? {} : { disable_web_page_preview: input.disableWebPagePreview }),
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
    });

    return {
      messageId: result.message_id,
      chatId: String(result.chat.id),
      date: result.date,
    };
  }

  async sendChatAction(input: { chatId?: string; action?: string }): Promise<boolean> {
    const chatId = input.chatId ?? this.defaultChatId;
    this.validateSendConfigured(chatId);
    return this.request<boolean>("sendChatAction", {
      chat_id: chatId,
      action: input.action ?? "typing",
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    this.validateBotConfigured();
    return this.request<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    this.validateBotConfigured();
    const response = await this.fetchImpl(`${this.baseUrl}/file/bot${this.token}/${filePath}`);
    if (!response.ok) {
      throw new TelegramBotApiError(`Telegram file download failed: ${response.status} ${await response.text()}`, {
        errorCode: response.status,
      });
    }
    return response.arrayBuffer();
  }

  async downloadFileAsDataUrl(fileId: string, mimeType: string): Promise<string> {
    const file = await this.getFile(fileId);
    if (!file.file_path) {
      throw new TelegramBotApiError("Telegram getFile returned no file_path.");
    }
    const bytes = await this.downloadFile(file.file_path);
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  async setWebhook(input: { url: string; secretToken?: string; allowedUpdates?: string[]; dropPendingUpdates?: boolean }): Promise<boolean> {
    this.validateBotConfigured();
    return this.request<boolean>("setWebhook", {
      url: input.url,
      ...(input.secretToken ?? this.webhookSecret ? { secret_token: input.secretToken ?? this.webhookSecret } : {}),
      allowed_updates: input.allowedUpdates ?? ["message", "callback_query"],
      ...(input.dropPendingUpdates === undefined ? {} : { drop_pending_updates: input.dropPendingUpdates }),
    });
  }

  async deleteWebhook(dropPendingUpdates = false): Promise<boolean> {
    this.validateBotConfigured();
    return this.request<boolean>("deleteWebhook", { drop_pending_updates: dropPendingUpdates });
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    this.validateBotConfigured();
    return this.request<TelegramWebhookInfo>("getWebhookInfo", {});
  }

  private async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    this.validateBotConfigured();
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => undefined) as TelegramApiResponse<T> | undefined;

    if (!response.ok || !body?.ok) {
      const description = body && !body.ok ? body.description : undefined;
      await recordProviderUsage({
        provider: "telegram",
        operation: method,
        status: "failed",
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        quotaUnits: method === "sendMessage" ? 1 : undefined,
        unit: method === "sendMessage" ? "message" : "request",
        metadata: {
          errorCode: body && !body.ok ? body.error_code : response.status,
          retryAfter: body && !body.ok ? body.parameters?.retry_after : undefined,
          description,
        },
      });
      throw new TelegramBotApiError(
        `Telegram Bot API ${method} failed: ${response.status}${description ? ` ${description}` : ""}`,
        {
          errorCode: body && !body.ok ? body.error_code : response.status,
          retryAfter: body && !body.ok ? body.parameters?.retry_after : undefined,
          migrateToChatId: body && !body.ok ? body.parameters?.migrate_to_chat_id : undefined,
        },
      );
    }

    await recordProviderUsage({
      provider: "telegram",
      operation: method,
      status: "succeeded",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      quotaUnits: method === "sendMessage" ? 1 : undefined,
      unit: method === "sendMessage" ? "message" : "request",
      metadata: summarizeTelegramResult(method, body.result),
    });
    return body.result;
  }
}

function summarizeTelegramResult(method: string, result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { method };
  }
  const record = result as Record<string, unknown>;
  const chat = record.chat && typeof record.chat === "object"
    ? record.chat as Record<string, unknown>
    : undefined;
  return {
    method,
    messageId: typeof record.message_id === "number" ? record.message_id : undefined,
    chatId: chat && (typeof chat.id === "number" || typeof chat.id === "string") ? String(chat.id) : undefined,
    fileSize: typeof record.file_size === "number" ? record.file_size : undefined,
  };
}

export function createTelegramBotClient(options: TelegramBotClientOptions = {}): TelegramBotClient {
  return new TelegramBotClient(options);
}

function constrainTelegramText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return normalized.length <= 4096 ? normalized : `${normalized.slice(0, 4093).trimEnd()}...`;
}
