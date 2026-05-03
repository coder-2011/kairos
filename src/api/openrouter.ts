import { ChatOpenRouter } from "@langchain/openrouter";

export type OpenRouterModelConfig = {
  apiKey?: string;
  model: string;
  temperature?: number;
};

export function createOpenRouterChatModel(config: OpenRouterModelConfig) {
  const { model, temperature = 0 } = config;
  const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }

  return new ChatOpenRouter({
    apiKey,
    model,
    temperature,
  });
}
