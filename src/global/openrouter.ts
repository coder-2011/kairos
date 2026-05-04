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

export type OpenRouterModelInfo = {
  id: string;
  name: string;
  contextLength?: number;
  supportedParameters: string[];
  inputModalities: string[];
  outputModalities: string[];
};

type OpenRouterModelsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    context_length?: number;
    supported_parameters?: string[];
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
  }>;
};

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

export async function listOpenRouterModels(input: {
  apiKey?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
  supportsToolsOnly?: boolean;
} = {}): Promise<OpenRouterModelInfo[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseURL = input.baseURL ?? "https://openrouter.ai/api/v1";
  const url = new URL(`${baseURL.replace(/\/$/, "")}/models`);
  if (input.supportsToolsOnly) {
    url.searchParams.set("supported_parameters", "tools");
  }

  const headers: Record<string, string> = {};
  const apiKey = input.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  return (payload.data ?? [])
    .filter((model): model is Required<Pick<NonNullable<OpenRouterModelsResponse["data"]>[number], "id">> & NonNullable<OpenRouterModelsResponse["data"]>[number] =>
      typeof model.id === "string" && model.id.length > 0,
    )
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextLength: model.context_length,
      supportedParameters: model.supported_parameters ?? [],
      inputModalities: model.architecture?.input_modalities ?? [],
      outputModalities: model.architecture?.output_modalities ?? [],
    }));
}

export function assertOpenRouterToolCapableModel(model: string): void {
  if (!isProbablyOpenRouterToolCapableModel(model)) {
    throw new Error(
      [
        `OpenRouter model ${model} is not known to support tool calling.`,
        "Use a model listed by OpenRouter with supported_parameters=tools,",
        "or run this agent without tools.",
      ].join(" "),
    );
  }
}

export function isProbablyOpenRouterToolCapableModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return [
    "openai/",
    "anthropic/",
    "google/gemini",
    "x-ai/",
    "qwen/",
    "deepseek/",
    "mistralai/mistral-large",
    "mistralai/devstral",
  ].some((prefix) => normalized.startsWith(prefix));
}
