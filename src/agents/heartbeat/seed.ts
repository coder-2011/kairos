import {
  type BranchConfig,
  type HeartbeatSeedBundle,
  type HeartbeatSeedDataProviders,
  type HeartbeatSeedRequest,
} from "./types.js";
import {
  getSupermemoryContainerTag,
  getSupermemoryProfileContainerTag,
} from "./memory.js";

export async function buildHeartbeatSeedBundle(
  branch: BranchConfig,
  providers: HeartbeatSeedDataProviders = {},
  now: Date = new Date(),
): Promise<HeartbeatSeedBundle> {
  const timestamp = now.toISOString();
  const generalMarketNewsWindowDays =
    branch.seededData?.generalMarketNewsWindowDays ?? 20;
  const request: HeartbeatSeedRequest = {
    branch,
    timestamp,
    seedWindowDays: branch.heartbeat.seedWindowDays,
    generalMarketNewsWindowDays,
    supermemoryContainerTag: getSupermemoryContainerTag(branch),
    supermemoryProfileContainerTag: getSupermemoryProfileContainerTag(branch),
  };

  const [
    currentPrice,
    recentVolume,
    tickerMovement,
    supermemoryContext,
    deepResearchMemoryContext,
    newsHeadlinesAndSummaries,
    generalMarketNews,
    priorDecisions,
  ] = await Promise.all([
    providers.getCurrentPrice?.(request) ?? null,
    providers.getRecentVolume?.(request) ?? null,
    providers.getTickerMovement?.(request) ?? null,
    providers.getSupermemoryContext?.(request) ?? null,
    providers.getDeepResearchMemoryContext?.(request) ?? null,
    providers.getNewsHeadlinesAndSummaries?.(request) ?? null,
    providers.getGeneralMarketNews?.(request) ?? null,
    providers.getPriorDecisions?.(request) ?? [],
  ]);

  const enabledOptionalSources = Object.entries(
    branch.seededData?.optionalSources ?? {},
  ).filter(([, enabled]) => enabled);
  const getOptionalData = providers.getOptionalData;

  const optionalData =
    getOptionalData && enabledOptionalSources.length > 0
      ? Object.fromEntries(
          await Promise.all(
            enabledOptionalSources.map(async ([sourceKey]) => {
              return [
                sourceKey,
                await getOptionalData({
                  ...request,
                  sourceKey,
                }),
              ] as const;
            }),
          ),
        )
      : {};

  return {
    branchId: branch.id,
    timestamp,
    law: branch.law,
    assets: branch.assets,
    seedWindowDays: branch.heartbeat.seedWindowDays,
    generalMarketNewsWindowDays,
    supermemoryContainerTag: request.supermemoryContainerTag,
    supermemoryProfileContainerTag: request.supermemoryProfileContainerTag,
    defaultSources: {
      currentPrice,
      recentVolume,
      tickerMovement,
      supermemoryContext,
      deepResearchMemoryContext,
      newsHeadlinesAndSummaries,
      generalMarketNews,
    },
    priorDecisions,
    optionalData,
  };
}
