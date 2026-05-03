import { describe, expect, it } from "vitest";

import { TwilioSmsClient } from "./twilio.js";

describe("TwilioSmsClient", () => {
  it("reports missing configuration before sending", () => {
    const client = new TwilioSmsClient();

    expect(client.configured).toBe(false);
    expect(() => client.validateConfigured()).toThrow(
      /TWILIO_ACCOUNT_SID.*TWILIO_AUTH_TOKEN.*TWILIO_FROM_NUMBER.*TWILIO_TO_NUMBER/,
    );
  });

  it("rejects matching from and to numbers locally", () => {
    const client = new TwilioSmsClient({
      accountSid: "AC_test",
      authToken: "auth_test",
      fromNumber: "+15555550100",
      toNumber: "+15555550100",
    });

    expect(client.configured).toBe(true);
    expect(() => client.validateConfigured()).toThrow(
      "TWILIO_TO_NUMBER must be different from TWILIO_FROM_NUMBER",
    );
  });

  it("accepts messaging service SID as sender configuration", () => {
    const client = new TwilioSmsClient({
      accountSid: "AC_test",
      authToken: "auth_test",
      messagingServiceSid: "MG123",
      toNumber: "+15555550100",
    });

    expect(client.configured).toBe(true);
    expect(() => client.validateConfigured()).not.toThrow();
  });
});
