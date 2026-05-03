export type KairosEnvValidationOptions = {
  requireModel?: boolean;
  requireMemory?: boolean;
  requireSearch?: boolean;
  requireMarketData?: boolean;
  requireBroker?: boolean;
};

export type KairosEnvValidationResult = {
  ok: boolean;
  missing: string[];
};

export function validateKairosEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: KairosEnvValidationOptions = {
    requireModel: true,
    requireMemory: true,
    requireSearch: true,
    requireMarketData: true,
  },
): KairosEnvValidationResult {
  const missing = [
    options.requireModel ? ["OPENROUTER_API_KEY", env.OPENROUTER_API_KEY] : null,
    options.requireMemory ? ["SUPERMEMORY_API_KEY", env.SUPERMEMORY_API_KEY] : null,
    options.requireSearch ? ["EXA_API_KEY", env.EXA_API_KEY] : null,
    options.requireMarketData ? ["FINNHUB_API_KEY", env.FINNHUB_API_KEY] : null,
    options.requireBroker ? ["ALPACA_API_KEY", env.ALPACA_API_KEY] : null,
    options.requireBroker ? ["ALPACA_SECRET_KEY", env.ALPACA_SECRET_KEY] : null,
  ]
    .filter((entry): entry is [string, string | undefined] => entry != null)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    ok: missing.length === 0,
    missing,
  };
}

export function getAlpacaBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";
}

export function validateAlpacaPaperEnv(
  env: NodeJS.ProcessEnv = process.env,
): KairosEnvValidationResult {
  const credentials = validateKairosEnv(env, {
    requireModel: false,
    requireMemory: false,
    requireSearch: false,
    requireMarketData: false,
    requireBroker: true,
  });
  const baseUrl = getAlpacaBaseUrl(env);
  const missing = [...credentials.missing];

  try {
    const url = new URL(baseUrl);
    if (url.hostname.endsWith("alpaca.markets") && url.hostname !== "paper-api.alpaca.markets") {
      missing.push("ALPACA_BASE_URL paper endpoint");
    }
  } catch {
    missing.push("ALPACA_BASE_URL valid URL");
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

export function assertKairosEnv(
  env?: NodeJS.ProcessEnv,
  options?: KairosEnvValidationOptions,
): void {
  const result = validateKairosEnv(env, options);
  if (!result.ok) {
    throw new Error(`Missing required environment variables: ${result.missing.join(", ")}`);
  }
}

export function hasFinnhubPremiumAccess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return /^(1|true|yes)$/i.test(env.FINNHUB_PREMIUM_ACCESS ?? "");
}
