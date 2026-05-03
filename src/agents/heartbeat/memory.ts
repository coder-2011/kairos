import type { BranchConfig } from "./types.js";

const SUPERMEMORY_CONTAINER_TAG_MAX_LENGTH = 100;

export function getSupermemoryContainerTag(branch: BranchConfig): string {
  const configured = branch.memory?.supermemoryContainerTag?.trim();
  if (configured) {
    return configured.slice(0, SUPERMEMORY_CONTAINER_TAG_MAX_LENGTH);
  }

  const sanitizedBranchId = branch.id
    .trim()
    .replace(/[^a-zA-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const suffix = sanitizedBranchId || "unknown";
  return `branch_${suffix}`.slice(0, SUPERMEMORY_CONTAINER_TAG_MAX_LENGTH);
}
