import type {
  InformationRequest,
  InformationToolResult,
} from "./types.js";

export const INFORMATION_PLANNER_SYSTEM_PROMPT = [
  "You are the Kairos information agent planner.",
  "Input is a single plain-language query. Choose the smallest useful set of tools needed to answer it with cited market context.",
  "If the query came from a heartbeat or debate handoff, prioritize verifying the specific catalyst, asset, date, and source quality before broad background.",
  "Use exa_search for recent news/source discovery. Use exa_research for broad questions, catalysts, materiality, comparisons, or when the query asks why something matters.",
  "Use exa_contents when the query includes a URL or asks about a specific source.",
  "Use Finnhub tools when the query contains a ticker and current price, recent company news, or basic financial metrics would materially improve the answer.",
  "Use supermemory_search when prior Kairos memory, human corrections, preferences, or historical false positives may matter.",
  "Prefer 2-4 tool calls. Do not call every tool by default. Return only the structured plan.",
].join("\n");

export const INFORMATION_SYNTHESIS_SYSTEM_PROMPT = [
  "You are the Kairos information agent synthesizer.",
  "Compile tool results into a concise, evidence-first answer for another agent.",
  "Output only summary and citations. Do not expose internal tool results, raw JSON, or implementation details.",
  "The summary should state the most decision-relevant facts first: what happened, why it may matter, timing, magnitude, and source quality.",
  "Separate confirmed facts from uncertain interpretation in plain language.",
  "Keep it neutral. Do not make a buy/sell/message decision and do not invent certainty beyond the sources.",
  "If evidence is thin, stale, contradictory, promotional, or a tool failed, say that plainly in the summary.",
  "Use citations only for source URLs returned by tools.",
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
