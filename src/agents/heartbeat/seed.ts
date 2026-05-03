import {
  type BranchConfig,
  type HeartbeatSeedBundle,
  type HeartbeatSeedDataProviders,
  type HeartbeatSeedRequest,
} from "./types.js";
import { getSupermemoryContainerTag } from "./memory.js";

export async function buildHeartbeatSeedBundle(
  branch: BranchConfig,
  providers: HeartbeatSeedDataProviders = {},
  now: Date = new Date(),
): Promise<HeartbeatSeedBundle> {
  const timestamp = now.toISOString();
  const request: HeartbeatSeedRequest = {
    branch,
    timestamp,
    seedWindowDays: branch.heartbeat.seedWindowDays,
    supermemoryContainerTag: getSupermemoryContainerTag(branch),
  };

  const [
    currentPrice,
    recentVolume,
    tickerMovement,
    supermemoryContext,
    newsHeadlinesAndSummaries,
  ] = await Promise.all([
    providers.getCurrentPrice?.(request) ?? null,
    providers.getRecentVolume?.(request) ?? null,
    providers.getTickerMovement?.(request) ?? null,
    providers.getSupermemoryContext?.(request) ?? null,
    providers.getNewsHeadlinesAndSummaries?.(request) ?? null,
  ]);

  const optionalData: Record<string, unknown> = {};
  const optionalSources = branch.seededData?.optionalSources ?? {};

  if (providers.getOptionalData) {
    await Promise.all(
      Object.entries(optionalSources).map(async ([sourceKey, enabled]) => {
        if (!enabled) {
          return;
        }

        optionalData[sourceKey] = await providers.getOptionalData?.({
          ...request,
          sourceKey,
        });
      }),
    );
  }

  return {
    branchId: branch.id,
    timestamp,
    law: branch.law,
    assets: branch.assets,
    seedWindowDays: branch.heartbeat.seedWindowDays,
    defaultSources: {
      currentPrice,
      recentVolume,
      tickerMovement,
      supermemoryContext,
      newsHeadlinesAndSummaries,
    },
    optionalData,
  };
}
