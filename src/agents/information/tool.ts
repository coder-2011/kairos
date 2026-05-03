import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { DebateTool, DebateTools } from "../debate/types.js";
import { runInformationAgent } from "./agent.js";
import type { InformationAgentDependencies } from "./types.js";

export const informationToolInputSchema = z.object({
  query: z.string().min(1),
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
      "Gather cited market context for a plain-language query using search, research, financial data, and memory tools.",
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
