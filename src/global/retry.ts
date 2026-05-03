export type RetryOptions = {
  attempts?: number;
  delayMs?: number;
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs * attempt);
      }
    }
  }

  throw lastError;
}

export async function retryFetch(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  options?: RetryOptions,
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetchImpl(input, init);
    if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`Retryable HTTP ${response.status}: ${await response.text()}`);
    }
    return response;
  }, options);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
