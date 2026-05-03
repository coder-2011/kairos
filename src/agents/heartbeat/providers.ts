import type { FinnhubApi } from "../../api/finnhub.js";
import { createFinnhubHeartbeatSeedProviders } from "../../api/finnhub.js";
import type { SupermemoryApi } from "../../api/supermemory.js";
import type { HeartbeatSeedDataProviders } from "./types.js";

export function createHeartbeatSeedProviders(input: {
  finnhub?: FinnhubApi;
  supermemory?: SupermemoryApi;
}): HeartbeatSeedDataProviders {
  const { finnhub, supermemory } = input;
  const finnhubProviders = finnhub
    ? createFinnhubHeartbeatSeedProviders(finnhub)
    : {};

  return {
    ...finnhubProviders,
    getSupermemoryContext: supermemory
      ? ({ branch, supermemoryContainerTag }) =>
          supermemory.getHeartbeatContext({
            containerTag: supermemoryContainerTag,
            query: [branch.law, ...branch.assets].join("\n"),
          })
      : finnhubProviders.getSupermemoryContext,
  };
}
