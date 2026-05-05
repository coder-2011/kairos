import { describe, expect, it } from "vitest";

import { TelegramBotApiError, TelegramBotClient } from "./telegram.js";

describe("TelegramBotClient", () => {
  it("reports missing bot token before sending", () => {
    const client = new TelegramBotClient({ token: "", defaultChatId: "123" });

    expect(client.configured).toBe(false);
    expect(() => client.validateBotConfigured()).toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("requires a chat id before sending", () => {
    const client = new TelegramBotClient({ token: "bot_token", defaultChatId: "" });

    expect(client.configured).toBe(true);
    expect(() => client.validateSendConfigured()).toThrow("TELEGRAM_CHAT_ID");
  });

  it("sends a Telegram message through the Bot API", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new TelegramBotClient({
      token: "bot_token",
      defaultChatId: "12345",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return jsonResponse({
          ok: true,
          result: { message_id: 7, date: 123, chat: { id: 12345, type: "private" } },
        });
      },
    });

    const result = await client.sendMessage({ text: "Kairos alert" });

    expect(requests[0]).toEqual({
      url: "https://api.telegram.org/botbot_token/sendMessage",
      body: { chat_id: "12345", text: "Kairos alert" },
    });
    expect(result).toEqual({ messageId: 7, chatId: "12345", date: 123 });
  });

  it("exposes Telegram retry_after errors", async () => {
    const client = new TelegramBotClient({
      token: "bot_token",
      defaultChatId: "12345",
      fetchImpl: async () => jsonResponse({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 4 },
      }, 429),
    });

    await expect(client.sendMessage({ text: "Kairos alert" })).rejects.toMatchObject({
      name: "TelegramBotApiError",
      retryAfter: 4,
    } satisfies Partial<TelegramBotApiError>);
  });

  it("verifies webhook secret headers when configured", () => {
    const client = new TelegramBotClient({ token: "bot_token", webhookSecret: "secret" });

    expect(client.verifyWebhookSecret("secret")).toBe(true);
    expect(client.verifyWebhookSecret("wrong")).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
