import { describe, expect, it } from "vitest";

import { TwilioSmsClient } from "../api/twilio.js";
import {
  GemmaSmsFormatter,
  TwilioTradingSmsNotifier,
  createTradingSmsNotifierFromEnv,
  type TradingSmsNotificationInput,
} from "./trading-sms.js";

const notificationInput: TradingSmsNotificationInput = {
  branchId: "branch_pltr",
  confidence: 0.91,
  debateTranscript: [{ agent: "bull", summary: "Material contract catalyst." }],
  finalAnswer: "Material contract catalyst.",
  permittedAction: "paper_order",
  symbol: "PLTR",
  threshold: 0.85,
};

describe("GemmaSmsFormatter", () => {
  it("formats through OpenRouter and constrains the SMS length", async () => {
    const formatter = new GemmaSmsFormatter({
      apiKey: "openrouter_test",
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        expect(payload.model).toBe("google/gemma-4-31b-it");
        expect(payload.messages[0].content).toContain("under 320 characters");
        return jsonResponse({
          choices: [
            {
              message: {
                content: `PLTR 91% paper order: ${"material contract catalyst ".repeat(30)}`,
              },
            },
          ],
        });
      },
    });

    const body = await formatter.format(notificationInput);

    expect(body.length).toBeLessThanOrEqual(320);
    expect(body).toContain("PLTR");
  });
});

describe("TwilioTradingSmsNotifier", () => {
  it("validates Twilio config before formatting", async () => {
    let formatterCalled = false;
    const notifier = new TwilioTradingSmsNotifier(
      {
        async format() {
          formatterCalled = true;
          return "should not be called";
        },
      },
      new TwilioSmsClient({
        accountSid: "AC_test",
        authToken: "auth_test",
        fromNumber: "+15555550100",
        toNumber: "+15555550100",
      }),
    );

    await expect(notifier.send(notificationInput)).rejects.toThrow(
      "TWILIO_TO_NUMBER must be different from TWILIO_FROM_NUMBER",
    );
    expect(formatterCalled).toBe(false);
  });

  it("stays disabled unless explicitly enabled in env", () => {
    expect(createTradingSmsNotifierFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      createTradingSmsNotifierFromEnv({
        KAIROS_SMS_NOTIFICATIONS_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(TwilioTradingSmsNotifier);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
