import type { FinnhubApi } from "../../api/finnhub.js";
import { createFinnhubHeartbeatSeedProviders } from "../../api/finnhub.js";
import type { GlobalMemoryApi } from "../../global/memory.js";
import type { HeartbeatSeedDataProviders } from "./types.js";

type HeartbeatMemorySeedApi = Pick<GlobalMemoryApi, "getHeartbeatContext" | "search">;

export function createHeartbeatSeedProviders(input: {
  finnhub?: FinnhubApi;
  memory?: HeartbeatMemorySeedApi;
  supermemory?: HeartbeatMemorySeedApi;
}): HeartbeatSeedDataProviders {
  const { finnhub } = input;
  const memory = input.memory ?? input.supermemory;
  const finnhubProviders = finnhub
    ? createFinnhubHeartbeatSeedProviders(finnhub)
    : {};

  return {
    ...finnhubProviders,
    getSupermemoryContext: memory
      ? ({ branch, supermemoryContainerTag }) =>
          memory.getHeartbeatContext({
            containerTag: supermemoryContainerTag,
            query: [branch.law, ...branch.assets].join("\n"),
          })
      : finnhubProviders.getSupermemoryContext,
    getPriorDecisions: memory
      ? async ({ branch, supermemoryContainerTag }) => {
          const response = await memory.search({
            q: [
              "Prior Kairos decisions for duplicate suppression.",
              `Branch ID: ${branch.id}`,
              `Branch law: ${branch.law}`,
              `Assets: ${branch.assets.join(", ")}`,
              "Find previous heartbeat outputs, heartbeat escalations, debate decisions, and no-escalation decisions about similar catalysts or upcoming events.",
            ].join("\n"),
            containerTag: supermemoryContainerTag,
            limit: 50,
            rerank: true,
            searchMode: "memories",
          });

          return response.results.map((result) => ({
            id: result.id,
            memory: result.memory,
            similarity: result.similarity,
            updatedAt: result.updatedAt,
            metadata: result.metadata,
          }));
        }
      : finnhubProviders.getPriorDecisions,
  };
}
