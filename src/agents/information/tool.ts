import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { DebateTool, DebateTools } from "../debate/types.js";
import { runInformationAgent } from "./agent.js";
import type { InformationAgentDependencies } from "./types.js";

export const informationToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Plain-language market research request. Include ticker/entity, catalyst, time window, and the specific fact pattern to verify when known."),
});

export function createInformationDebateTool(
  deps: InformationAgentDependencies,
): DebateTool {
  return (query) => runInformationAgent(query, deps);
}

export function createInformationDebateTools(
  deps: InformationAgentDependencies,
): DebateTools {
  return {
    information: createInformationDebateTool(deps),
  };
}

export function createInformationTool(
  deps: InformationAgentDependencies,
) {
  return tool({
    description:
      "Run the Kairos information workflow for a focused market-research question. Use when a debate or deep-research step needs cited facts from public search, source reads, Finnhub market/company data, or Kairos memory. Do not use for final buy/sell decisions, position sizing, trade execution, or questions answerable from the current transcript alone. Returns a concise evidence synthesis with citations where tools provide URLs and explicitly notes uncertainty or tool failures.",
    inputSchema: informationToolInputSchema,
    execute: ({ query }: z.infer<typeof informationToolInputSchema>) =>
      runInformationAgent(query, deps),
  });
}

export function createInformationToolSet(
  deps: InformationAgentDependencies,
): ToolSet {
  return {
    information: createInformationTool(deps),
  };
}
