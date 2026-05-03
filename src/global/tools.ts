import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ExaApi } from "../api/exa.js";
import type { FinnhubApi } from "../api/finnhub.js";
import {
  GLOBAL_MEMORY_CONTAINER_TAG,
  type GlobalMemoryApi,
} from "./memory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IGNORED_TICKER_TOKENS = new Set([
  "API",
  "CEO",
  "CFO",
  "CTO",
  "SEC",
  "USA",
  "USD",
  "THE",
  "AND",
  "FOR",
]);

const supermemoryProfileInputSchema = z.object({
  containerTag: z.string(),
  query: z.string(),
  threshold: z.number().min(0).max(1).optional(),
});
const supermemorySearchInputSchema = z.object({
  containerTag: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(20).optional(),
  threshold: z.number().min(0).max(1).optional(),
});
const exaNewsSearchInputSchema = z.object({
  query: z.string(),
  numResults: z.number().int().min(1).max(10).optional(),
});

export type GlobalToolName =
  | "exa_search"
  | "exa_research"
  | "exa_contents"
  | "exa_news_search"
  | "finnhub_quote"
  | "finnhub_company_news"
  | "finnhub_basic_financials"
  | "supermemory_profile"
  | "supermemory_search";

export type GlobalToolCitation = {
  title?: string;
  url: string;
  source?: string;
};

export type GlobalToolResult = {
  summary: string;
  citations?: GlobalToolCitation[];
  outputRef?: string;
  raw?: unknown;
};

export type GlobalToolContext = {
  containerTag?: string;
  now?: Date;
  [key: string]: unknown;
};

export type GlobalToolHandler = (
  input: string,
  context?: GlobalToolContext,
) => Promise<GlobalToolResult>;

export type GlobalToolRegistry = Partial<Record<GlobalToolName, GlobalToolHandler>>;

export type GlobalToolDependencies = {
  exa?: Pick<ExaApi, "search" | "answer" | "contents">;
  finnhub?: Pick<FinnhubApi, "quote" | "companyNews" | "basicFinancials">;
  memory?: Pick<GlobalMemoryApi, "search"> & Partial<Pick<GlobalMemoryApi, "profile">>;
  memoryContainerTag?: string;
  now?: () => Date;
};

export function createGlobalToolRegistry(
  deps: GlobalToolDependencies = {},
): GlobalToolRegistry {
  const registry: GlobalToolRegistry = {};

  if (deps.exa) {
    registry.exa_search = async (input) => {
      const response = await deps.exa?.search({
        query: input,
        numResults: 5,
        category: "news",
      });
      return summarizeExaResults(response);
    };
    registry.exa_news_search = registry.exa_search;
    registry.exa_research = async (input) => {
      const response = await deps.exa?.answer({ query: input, text: true });
      return {
        summary: response?.answer ?? "",
        citations:
          response?.citations.map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })) ?? [],
        raw: response,
      };
    };
    registry.exa_contents = async (input) => {
      const urls = extractUrls(input);
      const response = await deps.exa?.contents({
        urls: urls.length > 0 ? urls : [input],
        maxCharacters: 10_000,
      });
      return {
        summary:
          response?.results
            .map((item) =>
              [item.title ?? item.url, item.summary ?? item.text ?? ""]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n") ?? "",
        citations:
          response?.results.map((item) => ({
            title: item.title,
            url: item.url,
            source: item.author,
          })) ?? [],
        raw: response,
      };
    };
  }

  if (deps.finnhub) {
    registry.finnhub_quote = async (input) => {
      const ticker = inferTicker(input) ?? input.trim().split(/\s+/)[0];
      const quote = await deps.finnhub?.quote(ticker);
      return {
        summary: `Finnhub quote for ${ticker}: ${summarizeUnknown(quote)}`,
        citations: [],
        raw: quote,
      };
    };
    registry.finnhub_company_news = async (input, context) => {
      const ticker = inferTicker(input) ?? input.trim().split(/\s+/)[0];
      const now = context?.now ?? deps.now?.() ?? new Date();
      const to = formatDate(now);
      const from = formatDate(new Date(now.getTime() - 7 * DAY_MS));
      const news = await deps.finnhub?.companyNews({ symbol: ticker, from, to });
      const topNews = news?.slice(0, 5) ?? [];
      return {
        summary: topNews
          .map((item) =>
            [item.headline, item.source, item.summary, item.url]
              .filter(Boolean)
              .join(" - "),
          )
          .join("\n"),
        citations: topNews
          .filter((item) => item.url)
          .map((item) => ({
            title: item.headline,
            url: item.url as string,
            source: item.source,
          })),
        raw: topNews,
      };
    };
    registry.finnhub_basic_financials = async (input) => {
      const ticker = inferTicker(input) ?? input.trim().split(/\s+/)[0];
      const financials = await deps.finnhub?.basicFinancials(ticker);
      return {
        summary: `Finnhub basic financials for ${ticker}: ${summarizeUnknown(financials)}`,
        citations: [],
        raw: financials,
      };
    };
  }

  const profileMemory = deps.memory?.profile;
  if (profileMemory) {
    registry.supermemory_profile = async (input, context) => {
      const containerTag =
        context?.containerTag ??
        deps.memoryContainerTag ??
        GLOBAL_MEMORY_CONTAINER_TAG;
      const profile = await profileMemory({
        containerTag,
        q: input,
      });
      return {
        summary: summarizeUnknown(profile),
        citations: [],
        raw: profile,
      };
    };
  }

  if (deps.memory) {
    registry.supermemory_search = async (input, context) => {
      const containerTag =
        context?.containerTag ??
        deps.memoryContainerTag ??
        GLOBAL_MEMORY_CONTAINER_TAG;
      const memory = await deps.memory?.search({
        q: input,
        containerTag,
        limit: 5,
        searchMode: "memories",
        rerank: true,
      });
      return {
        summary:
          memory?.results
            .map((item) => `${item.memory} (similarity ${item.similarity})`)
            .join("\n") ?? "",
        citations: [],
        raw: memory,
      };
    };
  }

  return registry;
}

export async function executeGlobalTool(input: {
  registry: GlobalToolRegistry;
  toolName: GlobalToolName;
  toolInput: string;
  context?: GlobalToolContext;
}): Promise<GlobalToolResult> {
  const handler = input.registry[input.toolName];
  if (!handler) {
    throw new Error(`No implementation registered for tool ${input.toolName}.`);
  }

  return handler(input.toolInput, input.context);
}

export function createHeartbeatTools(input: {
  memory?: Pick<GlobalMemoryApi, "profile" | "search">;
  supermemory?: Pick<GlobalMemoryApi, "profile" | "search">;
  exa?: Pick<ExaApi, "search">;
}): ToolSet {
  const memory = input.memory ?? input.supermemory;
  const tools: ToolSet = {};

  if (memory) {
    tools.supermemory_profile = createSupermemoryProfileTool(memory);
    tools.supermemory_search = createSupermemorySearchTool(memory);
  }

  if (input.exa) {
    tools.exa_news_search = createExaSearchTool(input.exa);
  }

  return tools;
}

export function createSupermemoryProfileTool(
  memory: Pick<GlobalMemoryApi, "profile">,
) {
  return tool({
    description:
      "Fetch branch-scoped stable and recent Supermemory profile context.",
    inputSchema: supermemoryProfileInputSchema,
    execute: ({
      containerTag,
      query,
      threshold,
    }: z.infer<typeof supermemoryProfileInputSchema>) =>
      memory.profile({
        containerTag,
        q: query,
        threshold,
      }),
  });
}

export function createSupermemorySearchTool(
  memory: Pick<GlobalMemoryApi, "search">,
) {
  return tool({
    description:
      "Search branch-scoped Supermemory memories for prior related events, human corrections, and false positives.",
    inputSchema: supermemorySearchInputSchema,
    execute: ({
      containerTag,
      query,
      limit,
      threshold,
    }: z.infer<typeof supermemorySearchInputSchema>) =>
      memory.search({
        q: query,
        containerTag,
        limit,
        threshold,
        rerank: true,
        searchMode: "memories",
      }),
  });
}

export function createExaSearchTool(exa: Pick<ExaApi, "search">) {
  return tool({
    description:
      "Search recent web/news coverage when seeded headlines are insufficient.",
    inputSchema: exaNewsSearchInputSchema,
    execute: ({ query, numResults }: z.infer<typeof exaNewsSearchInputSchema>) =>
      exa.search({
        query,
        numResults,
        category: "news",
      }),
  });
}

function summarizeExaResults(response: Awaited<ReturnType<ExaApi["search"]>> | undefined) {
  return {
    summary:
      response?.results
        .map((item, index) =>
          [
            `${index + 1}. ${item.title ?? "Untitled"}`,
            item.url,
            item.summary,
          ]
            .filter(Boolean)
            .join(" - "),
        )
        .join("\n") ?? "",
    citations:
      response?.results.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.author,
      })) ?? [],
    raw: response,
  };
}

function formatDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function inferTicker(query: string): string | undefined {
  const match = query.match(/(?:^|[^A-Za-z])\$?([A-Z]{1,5})(?=[^A-Za-z]|$)/);
  const ticker = match?.[1];
  return ticker && !IGNORED_TICKER_TOKENS.has(ticker) ? ticker : undefined;
}

function summarizeUnknown(value: unknown, maxLength = 3000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractUrls(input: string): string[] {
  return Array.from(input.matchAll(/https?:\/\/[^\s),]+/g)).map((match) =>
    match[0],
  );
}
