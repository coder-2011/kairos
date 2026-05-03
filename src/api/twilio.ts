import twilio from "twilio";

export type TwilioSmsClientOptions = {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  toNumber?: string;
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

  constructor(options: TwilioSmsClientOptions = {}) {
    this.accountSid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
    this.fromNumber = options.fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? "";
    this.toNumber = options.toNumber ?? process.env.TWILIO_TO_NUMBER ?? "";
  }

  get configured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromNumber && this.toNumber);
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    if (!this.configured) {
      throw new Error(
        "Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and TWILIO_TO_NUMBER.",
      );
    }

    const client = twilio(this.accountSid, this.authToken);
    const message = await client.messages.create({
      body: input.body,
      from: this.fromNumber,
      to: this.toNumber,
    });

    return {
      sid: message.sid,
      status: message.status,
      to: this.toNumber,
      from: this.fromNumber,
    };
  }
}

export function createTwilioSmsClient(
  options: TwilioSmsClientOptions = {},
): TwilioSmsClient {
  return new TwilioSmsClient(options);
}
