import type { FinnhubApi } from "../../api/finnhub.js";
import { createFinnhubHeartbeatSeedProviders } from "../../api/finnhub.js";
import type { GlobalMemoryApi } from "../../global/memory.js";
import type { HeartbeatSeedDataProviders } from "./types.js";

export function createHeartbeatSeedProviders(input: {
  finnhub?: FinnhubApi;
  memory?: Pick<GlobalMemoryApi, "getHeartbeatContext">;
  supermemory?: Pick<GlobalMemoryApi, "getHeartbeatContext">;
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
  };
}
