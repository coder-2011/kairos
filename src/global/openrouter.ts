import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ChatOpenRouter } from "@langchain/openrouter";

export type OpenRouterConfig = {
  apiKey?: string;
  appName?: string;
  appUrl?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export type OpenRouterModelConfig = OpenRouterConfig & {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  user?: string;
  reasoning?: {
    effort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  };
  modelKwargs?: Record<string, unknown>;
};

export type OpenRouterProvider = ReturnType<typeof createOpenRouter>;
export type OpenRouterAiSdkChatModel = ReturnType<OpenRouterProvider["chat"]>;

export function createOpenRouterProvider(
  config: OpenRouterConfig = {},
): OpenRouterProvider {
  const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }

  return createOpenRouter({
    apiKey,
    appName: config.appName ?? process.env.OPENROUTER_APP_TITLE,
    appUrl: config.appUrl ?? process.env.OPENROUTER_HTTP_REFERER,
    baseURL: config.baseURL,
    headers: config.headers,
  });
}

export function createOpenRouterModel(
  config: OpenRouterModelConfig,
): OpenRouterAiSdkChatModel {
  const { model, temperature = 0, maxTokens, topP, user, reasoning } = config;
  const provider = createOpenRouterProvider(config);

  return provider.chat(model, {
    temperature,
    maxTokens,
    topP,
    user,
    reasoning,
  });
}

export function createOpenRouterChatModel(config: OpenRouterModelConfig) {
  const { model, temperature = 0, reasoning, modelKwargs } = config;
  const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }

  return new ChatOpenRouter({
    apiKey,
    model,
    temperature,
    modelKwargs: {
      ...modelKwargs,
      ...(reasoning ? { reasoning } : {}),
    },
  });
}
