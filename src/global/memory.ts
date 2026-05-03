import {
  SupermemoryApi,
  type SupermemoryConfig,
  type SupermemorySearchRequest,
  type SupermemorySearchResponse,
  type SupermemoryProfileRequest,
  type SupermemoryProfileResponse,
  type SupermemoryAddContentRequest,
  type SupermemoryAddContentResponse,
  type SupermemoryCreateMemoriesRequest,
  type SupermemoryCreateMemoriesResponse,
  type SupermemoryUpdateMemoryRequest,
} from "../api/supermemory.js";
import type {
  BranchConfig,
  EscalationEvent,
  HeartbeatOutput,
  HeartbeatSeedBundle,
  HeartbeatToolTrace,
} from "../agents/heartbeat/types.js";

export const GLOBAL_MEMORY_CONTAINER_TAG = "system_global";

const MEMORY_CONTAINER_TAG_MAX_LENGTH = 100;

export type GlobalMemoryApi = {
  search(request: SupermemorySearchRequest): Promise<SupermemorySearchResponse>;
  profile(request: SupermemoryProfileRequest): Promise<SupermemoryProfileResponse>;
  addContent(
    request: SupermemoryAddContentRequest,
  ): Promise<SupermemoryAddContentResponse>;
  createMemories(
    request: SupermemoryCreateMemoriesRequest,
  ): Promise<SupermemoryCreateMemoriesResponse>;
  updateMemory(request: SupermemoryUpdateMemoryRequest): Promise<unknown>;
  forgetMemory(memoryId: string): Promise<unknown>;
  getHeartbeatContext(input: {
    containerTag: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<SupermemoryProfileResponse & { search: SupermemorySearchResponse }>;
  writeHeartbeatOutput(input: {
    containerTag: string;
    output: HeartbeatOutput;
    seedBundle?: HeartbeatSeedBundle;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<SupermemoryCreateMemoriesResponse>;
  writeEscalationEvent(input: {
    containerTag: string;
    event: EscalationEvent;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<SupermemoryAddContentResponse>;
  writeConversation(input: {
    containerTag: string;
    customId: string;
    content?: string;
    messages?: Array<{
      role: string;
      content: string;
      name?: string;
      timestamp?: string;
    }>;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<SupermemoryAddContentResponse>;
  writeToolTraces(input: {
    containerTag: string;
    traces: HeartbeatToolTrace[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<SupermemoryCreateMemoriesResponse>;
};

export function createSupermemoryMemoryApi(
  config: SupermemoryConfig = {},
): GlobalMemoryApi {
  return new SupermemoryApi(config);
}

export function getMemoryContainerTag(input: {
  configuredContainerTag?: string;
  scopeId?: string;
  prefix?: string;
  fallback?: string;
}): string {
  const configured = input.configuredContainerTag?.trim();
  if (configured) {
    return configured.slice(0, MEMORY_CONTAINER_TAG_MAX_LENGTH);
  }

  const sanitizedScopeId = (input.scopeId ?? input.fallback ?? "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const suffix = sanitizedScopeId || "unknown";
  return `${input.prefix ?? "scope"}_${suffix}`.slice(
    0,
    MEMORY_CONTAINER_TAG_MAX_LENGTH,
  );
}

export function getBranchMemoryContainerTag(branch: BranchConfig): string {
  return getMemoryContainerTag({
    configuredContainerTag: branch.memory?.supermemoryContainerTag,
    scopeId: branch.id,
    prefix: "branch",
  });
}

export function getBranchProfileContainerTag(branch: BranchConfig): string {
  return getMemoryContainerTag({
    configuredContainerTag: branch.memory?.supermemoryProfileContainerTag,
    scopeId: branch.id,
    prefix: "branch_profile",
  });
}
