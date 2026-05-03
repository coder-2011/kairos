import { describe, expect, it } from "vitest";

import { ExaApi } from "../../api/exa.js";
import { FinnhubApi } from "../../api/finnhub.js";
import { createOpenRouterChatModel } from "../../api/openrouter.js";
import { SupermemoryApi } from "../../api/supermemory.js";
import { runInformationAgent } from "./agent.js";
import type { StructuredInformationModelProvider } from "./types.js";

const liveTestsEnabled =
  process.env.KAIROS_LIVE_TESTS === "1" &&
  Boolean(process.env.OPENROUTER_API_KEY) &&
  Boolean(process.env.EXA_API_KEY) &&
  Boolean(process.env.FINNHUB_API_KEY) &&
  Boolean(process.env.SUPERMEMORY_API_KEY);

const liveIt = liveTestsEnabled ? it : it.skip;

function liveModel(): StructuredInformationModelProvider {
  return createOpenRouterChatModel({
    model: process.env.KAIROS_LIVE_OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    temperature: 0,
  }) as StructuredInformationModelProvider;
}

describe("information agent live integrations", () => {
  liveIt(
    "runs the full information agent with live model and provider APIs",
    async () => {
      const result = await runInformationAgent(
        "Gather the most important recent PLTR catalyst context with cited current sources, market data, and Kairos memory.",
        {
          model: liveModel(),
          exa: new ExaApi(),
          finnhub: new FinnhubApi(),
          supermemory: new SupermemoryApi(),
          supermemoryContainerTag: "system_global",
        },
      );

      expect(result.summary.length).toBeGreaterThan(20);
      expect("toolResults" in result).toBe(false);
      expect(result.citations.length).toBeGreaterThan(0);
    },
    90_000,
  );
});
