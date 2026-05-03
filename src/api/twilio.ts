import twilio from "twilio";

export type TwilioSmsClientOptions = {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  toNumber?: string;
  messagingServiceSid?: string;
};

export type SendSmsInput = {
  body: string;
  urgent?: boolean;
};

export type SendSmsResult = {
  sid: string;
  status?: string;
  to: string;
  from: string;
};

export class TwilioSmsClient {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly toNumber: string;
  private readonly messagingServiceSid: string;

  constructor(options: TwilioSmsClientOptions = {}) {
    this.accountSid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
    this.fromNumber = options.fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? "";
    this.toNumber = options.toNumber ?? process.env.TWILIO_TO_NUMBER ?? "";
    this.messagingServiceSid =
      options.messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID ?? "";
  }

  get configured(): boolean {
    return Boolean(
      this.accountSid &&
        this.authToken &&
        this.toNumber &&
        (this.fromNumber || this.messagingServiceSid),
    );
  }

  validateConfigured(): void {
    const missing = [
      ["TWILIO_ACCOUNT_SID", this.accountSid],
      ["TWILIO_AUTH_TOKEN", this.authToken],
      [
        this.messagingServiceSid ? "TWILIO_MESSAGING_SERVICE_SID" : "TWILIO_FROM_NUMBER",
        this.messagingServiceSid || this.fromNumber,
      ],
      ["TWILIO_TO_NUMBER", this.toNumber],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Twilio SMS is not configured. Missing: ${missing.join(", ")}.`);
    }

    if (!this.messagingServiceSid && normalizePhoneNumber(this.fromNumber) === normalizePhoneNumber(this.toNumber)) {
      throw new Error("Twilio SMS is not configured. TWILIO_TO_NUMBER must be different from TWILIO_FROM_NUMBER.");
    }
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    this.validateConfigured();

    const client = twilio(this.accountSid, this.authToken);
    const message = await client.messages.create({
      body: formatSmsBody(input),
      ...(this.messagingServiceSid
        ? { messagingServiceSid: this.messagingServiceSid }
        : { from: this.fromNumber }),
      to: this.toNumber,
    });

    return {
      sid: message.sid,
      status: message.status,
      to: this.toNumber,
      from: message.from,
    };
  }
}

export function createTwilioSmsClient(
  options: TwilioSmsClientOptions = {},
): TwilioSmsClient {
  return new TwilioSmsClient(options);
}

function formatSmsBody(input: SendSmsInput): string {
  const body = input.body.replace(/\s+/g, " ").trim();
  return input.urgent && !/^urgent:/i.test(body) ? `URGENT: ${body}` : body;
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\s+/g, "");
}
