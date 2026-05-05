import { describe, expect, it } from "vitest";

import { TelegramBotClient } from "../api/telegram.js";
import {
  GemmaTelegramFormatter,
  TelegramTradingNotifier,
  createTradingTelegramNotifierFromEnv,
  type TradingTelegramNotificationInput,
} from "./trading-telegram.js";

const notificationInput: TradingTelegramNotificationInput = {
  branchId: "branch_pltr",
  confidence: 0.91,
  debateTranscript: [{ agent: "bull", summary: "Material contract catalyst." }],
  finalAnswer: "Material contract catalyst.",
  permittedAction: "paper_order",
  symbol: "PLTR",
  threshold: 0.85,
};

describe("GemmaTelegramFormatter", () => {
  it("formats through OpenRouter and constrains the Telegram length", async () => {
    const formatter = new GemmaTelegramFormatter({
      apiKey: "openrouter_test",
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        expect(payload.model).toBe("google/gemma-4-31b-it");
        expect(payload.messages[0].content).toContain("under 1000 characters");
        return jsonResponse({
          choices: [
            {
              message: {
                content: `PLTR 91% paper order: ${"material contract catalyst ".repeat(80)}`,
              },
            },
          ],
        });
      },
    });

    const body = await formatter.format(notificationInput);

    expect(body.length).toBeLessThanOrEqual(1000);
    expect(body).toContain("PLTR");
  });
});

describe("TelegramTradingNotifier", () => {
  it("validates Telegram chat config before formatting", async () => {
    let formatterCalled = false;
    const notifier = new TelegramTradingNotifier(
      {
        async format() {
          formatterCalled = true;
          return "should not be called";
        },
      },
      new TelegramBotClient({ token: "bot_token", defaultChatId: "" }),
    );

    await expect(notifier.send(notificationInput)).rejects.toThrow("TELEGRAM_CHAT_ID");
    expect(formatterCalled).toBe(false);
  });

  it("can resolve chat id from a provider", async () => {
    const sent: unknown[] = [];
    const notifier = new TelegramTradingNotifier(
      { async format() { return "PLTR alert"; } },
      new TelegramBotClient({
        token: "bot_token",
        fetchImpl: async (_url, init) => {
          sent.push(JSON.parse(String(init?.body)));
          return jsonResponse({ ok: true, result: { message_id: 9, chat: { id: 777, type: "private" } } });
        },
      }),
      async () => "777",
    );

    const result = await notifier.send(notificationInput);

    expect(sent).toEqual([{ chat_id: "777", text: "PLTR alert", disable_web_page_preview: true }]);
    expect(result).toMatchObject({ provider: "telegram", chatId: "777", messageId: 9 });
  });

  it("stays disabled unless explicitly enabled in env", () => {
    expect(createTradingTelegramNotifierFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      createTradingTelegramNotifierFromEnv({
        KAIROS_TELEGRAM_NOTIFICATIONS_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(TelegramTradingNotifier);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
