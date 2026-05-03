import { createTwilioSmsClient, type TwilioSmsClient } from "../api/twilio.js";

export type TradingSmsNotificationInput = {
  branchId?: string;
  lawId?: string;
  runId?: string;
  symbol?: string;
  confidence: number;
  threshold: number;
  finalAnswer: string;
  permittedAction: string;
  debateTranscript: unknown[];
  tradeIntent?: unknown;
};

export type TradingSmsNotificationResult = {
  body: string;
  provider: "twilio";
  sid?: string;
  status?: string;
  sent: boolean;
  error?: string;
};

export type TradingSmsNotifier = {
  send(input: TradingSmsNotificationInput): Promise<TradingSmsNotificationResult>;
};

export type SmsFormatter = {
  format(input: TradingSmsNotificationInput): Promise<string>;
};

export const TRADING_SMS_FORMATTING_GOAL = [
  "Format a concise SMS alert for a human monitoring Kairos trading agents.",
  "Use the final answer and the whole multi-agent debate transcript as context.",
  "Do not add new facts, price targets, or certainty not present in the transcript.",
  "Include ticker/branch if known, confidence as a percentage, the selected action, and the core reason.",
  "Keep the SMS under 320 characters. Prefer one sentence.",
].join(" ");

export type GemmaSmsFormatterOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class GemmaSmsFormatter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GemmaSmsFormatterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.model =
      options.model ??
      process.env.KAIROS_NOTIFICATION_MODEL ??
      "google/gemma-4-31b-it";
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async format(input: TradingSmsNotificationInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is required to format SMS notifications.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: TRADING_SMS_FORMATTING_GOAL,
          },
          {
            role: "user",
            content: JSON.stringify({
              branchId: input.branchId,
              lawId: input.lawId,
              runId: input.runId,
              symbol: input.symbol,
              confidence: input.confidence,
              threshold: input.threshold,
              permittedAction: input.permittedAction,
              finalAnswer: input.finalAnswer,
              tradeIntent: input.tradeIntent,
              debateTranscript: input.debateTranscript,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter SMS formatter failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const body = payload.choices?.[0]?.message?.content?.trim();
    if (!body) {
      throw new Error("OpenRouter SMS formatter returned an empty message.");
    }

    return constrainSms(body);
  }
}

export class TwilioTradingSmsNotifier implements TradingSmsNotifier {
  constructor(
    private readonly formatter: SmsFormatter = new GemmaSmsFormatter(),
    private readonly smsClient: TwilioSmsClient = createTwilioSmsClient(),
  ) {}

  async send(input: TradingSmsNotificationInput): Promise<TradingSmsNotificationResult> {
    this.smsClient.validateConfigured();
    const body = await this.formatter.format(input);
    const result = await this.smsClient.send({
      body,
      urgent: input.permittedAction.includes("order"),
    });

    return {
      body,
      provider: "twilio",
      sid: result.sid,
      status: result.status,
      sent: true,
    };
  }
}

export function createTradingSmsNotifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TradingSmsNotifier | undefined {
  if (!/^(1|true|yes)$/i.test(env.KAIROS_SMS_NOTIFICATIONS_ENABLED ?? "")) {
    return undefined;
  }

  return new TwilioTradingSmsNotifier();
}

function constrainSms(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 317).trimEnd()}...`;
}
