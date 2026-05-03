import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type { ExaApi } from "../../api/exa.js";
import type { SupermemoryApi } from "../../api/supermemory.js";
import type { HeartbeatTool } from "./agent.js";

export function createHeartbeatTools(input: {
  supermemory?: SupermemoryApi;
  exa?: ExaApi;
}): HeartbeatTool[] {
  const tools: HeartbeatTool[] = [];

  if (input.supermemory) {
    tools.push(
      createSupermemoryProfileTool(input.supermemory),
      createSupermemorySearchTool(input.supermemory),
    );
  }

  if (input.exa) {
    tools.push(createExaSearchTool(input.exa));
  }

  return tools;
}

export function createSupermemoryProfileTool(supermemory: SupermemoryApi) {
  return tool(
    ({ containerTag, query, threshold }) =>
      supermemory.profile({
        containerTag,
        q: query,
        threshold,
      }),
    {
      name: "supermemory_profile",
      description:
        "Fetch branch-scoped stable and recent Supermemory profile context.",
      schema: z.object({
        containerTag: z.string(),
        query: z.string(),
        threshold: z.number().min(0).max(1).optional(),
      }),
    },
  );
}

export function createSupermemorySearchTool(supermemory: SupermemoryApi) {
  return tool(
    ({ containerTag, query, limit, threshold }) =>
      supermemory.search({
        q: query,
        containerTag,
        limit,
        threshold,
        rerank: true,
        searchMode: "memories",
      }),
    {
      name: "supermemory_search",
      description:
        "Search branch-scoped Supermemory memories for prior related events, human corrections, and false positives.",
      schema: z.object({
        containerTag: z.string(),
        query: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
        threshold: z.number().min(0).max(1).optional(),
      }),
    },
  );
}

export function createExaSearchTool(exa: ExaApi) {
  return tool(
    ({ query, numResults }) =>
      exa.search({
        query,
        numResults,
        category: "news",
      }),
    {
      name: "exa_news_search",
      description:
        "Search recent web/news coverage when seeded headlines are insufficient.",
      schema: z.object({
        query: z.string(),
        numResults: z.number().int().min(1).max(10).optional(),
      }),
    },
  );
}
