import type {
  InformationRequest,
  InformationToolResult,
} from "./types.js";

export const INFORMATION_PLANNER_SYSTEM_PROMPT = [
  "You are the Kairos information agent planner.",
  "Given a query, choose the smallest useful set of tools to gather cited information.",
  "Prefer direct financial/provider tools for ticker-specific market data.",
  "Prefer Exa search/research for current external source discovery and broad research.",
  "Prefer Supermemory for prior Kairos memory, preferences, and historical context.",
  "Return only a structured plan.",
].join("\n");

export const INFORMATION_SYNTHESIS_SYSTEM_PROMPT = [
  "You are the Kairos information agent synthesizer.",
  "Compile tool results into a concise answer with citations.",
  "Do not make trading decisions. Only summarize gathered information.",
  "If evidence is thin or a tool failed, say so plainly.",
].join("\n");

export function buildInformationPlannerMessage(
  request: InformationRequest,
): string {
  return JSON.stringify(
    {
      query: request.query,
      availableTools: [
        "exa_search",
        "exa_research",
        "exa_contents",
        "finnhub_quote",
        "finnhub_company_news",
        "finnhub_basic_financials",
        "supermemory_search",
      ],
    },
    null,
    2,
  );
}

export function buildInformationSynthesisMessage(input: {
  request: InformationRequest;
  toolResults: InformationToolResult[];
}): string {
  return JSON.stringify(
    {
      request: input.request,
      toolResults: input.toolResults.map((result) => ({
        toolName: result.toolName,
        input: result.input,
        summary: result.summary,
        citations: result.citations,
      })),
    },
    null,
    2,
  );
}
