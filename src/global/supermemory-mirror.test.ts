import { describe, expect, it } from "vitest";

import {
  createSupermemoryMirror,
  createSupermemoryObserver,
  formatMirrorRecord,
  redactSecrets,
  redactText,
  type SupermemoryMirrorTarget,
} from "./supermemory-mirror.js";

describe("Supermemory mirror", () => {
  it("writes compact redacted records to the primary branch profile container", async () => {
    const writes: Array<{
      kind?: string;
      containerTag: string;
      customId?: string;
      content: string;
      metadata?: Record<string, string | number | boolean>;
    }> = [];
    const mirror = createSupermemoryMirror({
      memory: createMemoryTarget(writes),
    });

    await mirror.mirrorRecord({
      type: "run.completed",
      scope: "run_event",
      runId: "run_1",
      branchId: "branch_1",
      timestamp: "2026-05-03T12:00:00.000Z",
      summary: "Run completed.",
      data: {
        public: "ok",
        OPENROUTER_API_KEY: "should-not-leak",
        nested: {
          authorization: "Bearer should-not-leak",
        },
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.kind).toBe("memory");
    expect(writes[0]?.containerTag).toBe("branch_profile_branch_1");
    expect(writes[0]?.content).toContain("Run completed.");
    expect(writes[0]?.content).not.toContain("should-not-leak");
    expect(writes[0]?.metadata).toMatchObject({
      type: "run.completed",
      scope: "run_event",
      run_id: "run_1",
      branch_id: "branch_1",
    });
  });

  it("formats debate transcripts through writeConversation", async () => {
    const writes: Array<{ kind?: string; containerTag: string; customId?: string; content: string }> = [];
    const mirror = createSupermemoryMirror({
      memory: createMemoryTarget(writes),
    });

    await mirror.mirrorDebateResult({
      runId: "run_2",
      branchId: "branch_2",
      result: {
        debateId: "debate_1",
        status: "completed",
        messages: [
          {
            agentName: "bull",
            messageType: "argument",
            argument: "The catalyst may be underpriced.",
            confidence: 0.7,
          },
        ],
        toolEvents: [],
        humanInterjections: [
          {
            timestamp: "2026-05-03T12:00:00.000Z",
            summary: "Check whether this is already priced in.",
          },
        ],
        finalDecision: {
          summary: "Notify but do not trade yet.",
          action: "watch",
          confidence: 0.65,
          citations: [],
        },
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.kind).toBe("memory");
    expect(writes[0]?.containerTag).toBe("branch_profile_branch_2");
    expect(writes[0]?.content).toContain("Notify but do not trade yet.");
  });

  it("uses explicit branch container tags instead of deriving defaults", async () => {
    const writes: Array<{ kind?: string; containerTag: string; customId?: string; content: string }> = [];
    const mirror = createSupermemoryMirror({
      memory: createMemoryTarget(writes),
    });

    await mirror.mirrorRecord({
      type: "branch.updated",
      scope: "branch",
      branchId: "branch_legacy",
      timestamp: "2026-05-03T12:00:00.000Z",
      summary: "Branch updated.",
      containerTags: ["branch_custom", "branch_profile_custom"],
    });

    expect(writes.map((write) => write.containerTag)).toEqual([
      "branch_profile_custom",
    ]);
  });

  it("keeps formatter redaction available independently", () => {
    expect(redactSecrets({ token: "abc", keep: "value" })).toEqual({
      token: "[REDACTED]",
      keep: "value",
    });
    expect(redactText("authorization: Bearer secret-value")).toBe(
      "authorization=[REDACTED]",
    );
    expect(formatMirrorRecord({
      type: "branch.updated",
      scope: "branch",
      title: "Branch",
      data: { password: "abc" },
    })).not.toContain("abc");
  });

  it("can mirror agent observations", async () => {
    const writes: Array<{ kind?: string; containerTag: string; customId?: string; content: string }> = [];
    const mirror = createSupermemoryMirror({
      memory: createMemoryTarget(writes),
    });
    const observer = createSupermemoryObserver(mirror);

    await observer.event({
      agent: "heartbeat",
      type: "model_complete",
      runId: "run_3",
      branchId: "branch_3",
      timestamp: "2026-05-03T12:00:00.000Z",
      payload: { summary: "done" },
    });

    expect(writes.map((write) => write.containerTag)).toEqual([
      "branch_profile_branch_3",
    ]);
    expect(writes.some((write) => write.content.includes("model_complete"))).toBe(true);
  });
});

function createMemoryTarget(
  writes: Array<{ kind?: string; containerTag: string; customId?: string; content: string; metadata?: Record<string, string | number | boolean> }>,
): SupermemoryMirrorTarget {
  return {
    async addContent(input) {
      writes.push({ kind: "document", ...input });
      return { id: `write_${writes.length}`, status: "queued" };
    },
    async createMemories(input) {
      for (const memory of input.memories) {
        writes.push({
          kind: "memory",
          containerTag: input.containerTag,
          content: memory.content,
          metadata: memory.metadata,
        });
      }
      return {
        documentId: null,
        memories: input.memories.map((_, index) => ({
          id: `memory_${index}`,
          memory: input.memories[index]?.content ?? "",
          isStatic: input.memories[index]?.isStatic ?? false,
          createdAt: "2026-05-03T12:00:00.000Z",
        })),
      };
    },
    async writeConversation(input) {
      writes.push({
        kind: "conversation",
        containerTag: input.containerTag,
        customId: input.customId,
        content: input.content ?? JSON.stringify(input.messages ?? []),
        metadata: input.metadata,
      });
      return { id: `write_${writes.length}`, status: "queued" };
    },
  };
}
