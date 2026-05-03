import type { DebateRunResult } from "../agents/debate/types.js";
import type { InformationResult } from "../agents/information/types.js";
import type { GlobalMemoryApi } from "./memory.js";
import { GLOBAL_MEMORY_CONTAINER_TAG, getMemoryContainerTag } from "./memory.js";

export type SupermemoryMirrorTarget = Pick<GlobalMemoryApi, "addContent" | "writeConversation">;

export type SupermemoryMirrorRecord = {
  type: string;
  scope: string;
  timestamp?: string;
  runId?: string;
  branchId?: string;
  lawId?: string;
  debateId?: string;
  artifactId?: string;
  actor?: string;
  source?: string;
  title?: string;
  summary?: string;
  content?: string;
  data?: unknown;
  metadata?: Record<string, string | number | boolean | undefined>;
  containerTags?: string[];
  customId?: string;
};

export type SupermemoryMirrorOptions = {
  memory: SupermemoryMirrorTarget;
  globalContainerTag?: string;
  /**
   * Best-effort is the production default: local audit persistence must not
   * fail just because the external memory mirror is temporarily unavailable.
   */
  required?: boolean;
  maxContentChars?: number;
  onError?: (error: unknown, record: SupermemoryMirrorRecord) => void | Promise<void>;
};

export type SupermemoryMirror = {
  mirrorRecord(record: SupermemoryMirrorRecord): Promise<void>;
  mirrorDebateResult(input: {
    result: DebateRunResult;
    runId?: string;
    branchId?: string;
    lawId?: string;
    source?: string;
  }): Promise<void>;
  mirrorInformationResult(input: {
    query: string;
    result: InformationResult;
    runId?: string;
    branchId?: string;
    lawId?: string;
    source?: string;
  }): Promise<void>;
};

const DEFAULT_MAX_CONTENT_CHARS = 200_000;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key)/i;

export function createSupermemoryMirror(
  options: SupermemoryMirrorOptions,
): SupermemoryMirror {
  const globalContainerTag =
    options.globalContainerTag ?? GLOBAL_MEMORY_CONTAINER_TAG;
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;

  const write = async (record: SupermemoryMirrorRecord): Promise<void> => {
    const tags = containerTagsForRecord(record, globalContainerTag);
    const content = truncateContent(formatMirrorRecord(record), maxContentChars);
    const metadata = compactMetadata({
      type: record.type,
      scope: record.scope,
      timestamp: record.timestamp,
      run_id: record.runId,
      branch_id: record.branchId,
      law_id: record.lawId,
      debate_id: record.debateId,
      artifact_id: record.artifactId,
      actor: record.actor,
      source: record.source,
      content_truncated: content.truncated,
      ...record.metadata,
    });

    await Promise.all(
      tags.map((containerTag) =>
        options.memory.addContent({
          containerTag,
          customId: safeCustomId(
            record.customId ??
              [
                "kairos",
                record.scope,
                record.type,
                record.runId,
                record.branchId,
                record.debateId,
                record.artifactId,
                record.timestamp,
              ]
                .filter(Boolean)
                .join(":"),
          ),
          content: content.value,
          metadata,
        }),
      ),
    );
  };

  return {
    mirrorRecord: (record) => mirrorBestEffort(record, write, options),
    async mirrorDebateResult(input) {
      const { result } = input;
      const transcriptMessages = [
        ...result.humanInterjections.map((item) => ({
          role: "human",
          name: "human",
          timestamp: item.timestamp,
          content: item.summary,
        })),
        ...result.messages.map((message) => ({
          role: "agent",
          name: message.agentName,
          content: [
            `[${message.messageType}]`,
            message.confidence === undefined
              ? undefined
              : `confidence=${message.confidence}`,
            message.argument,
          ]
            .filter(Boolean)
            .join(" "),
        })),
        {
          role: "judge",
          name: "final",
          content: `Final decision confidence=${result.finalDecision.confidence}: ${result.finalDecision.summary}`,
        },
      ];

      const record: SupermemoryMirrorRecord = {
        type: "debate_transcript",
        scope: "debate",
        runId: input.runId,
        branchId: input.branchId,
        lawId: input.lawId,
        debateId: result.debateId,
        source: input.source ?? "debate_agent",
        title: `Kairos debate ${result.debateId}`,
        summary: result.finalDecision.summary,
        data: {
          status: result.status,
          messages: result.messages,
          toolEvents: result.toolEvents,
          humanInterjections: result.humanInterjections,
          currentPlan: result.currentPlan,
          finalDecision: result.finalDecision,
        },
        customId: `kairos:debate:${result.debateId}:transcript`,
      };

      await mirrorBestEffort(record, async (mirroredRecord) => {
        const content = truncateContent(formatMirrorRecord(mirroredRecord), maxContentChars);
        await Promise.all(
          containerTagsForRecord(mirroredRecord, globalContainerTag).map(
            (containerTag) =>
              options.memory.writeConversation({
                containerTag,
                customId: safeCustomId(mirroredRecord.customId ?? `kairos:debate:${result.debateId}:transcript`),
                content: content.value,
                messages: transcriptMessages,
                metadata: compactMetadata({
                  type: mirroredRecord.type,
                  scope: mirroredRecord.scope,
                  run_id: mirroredRecord.runId,
                  branch_id: mirroredRecord.branchId,
                  law_id: mirroredRecord.lawId,
                  debate_id: mirroredRecord.debateId,
                  source: mirroredRecord.source,
                  message_count: result.messages.length,
                  tool_event_count: result.toolEvents.length,
                  human_interjection_count: result.humanInterjections.length,
                  citation_count: result.finalDecision.citations.length,
                  content_truncated: content.truncated,
                }),
              }),
          ),
        );
      }, options);
    },
    mirrorInformationResult(input) {
      return mirrorBestEffort(
        {
          type: "information_result",
          scope: "information",
          runId: input.runId,
          branchId: input.branchId,
          lawId: input.lawId,
          source: input.source ?? "information_agent",
          title: `Kairos information result: ${input.query}`,
          summary: input.result.summary,
          data: {
            query: input.query,
            result: input.result,
          },
          metadata: {
            citation_count: input.result.citations.length,
          },
          customId: `kairos:information:${input.runId ?? safeCustomId(input.query)}:result`,
        },
        write,
        options,
      );
    },
  };
}

export function formatMirrorRecord(record: SupermemoryMirrorRecord): string {
  const timestamp = record.timestamp ?? new Date().toISOString();
  const data = redactSecrets(record.data);
  return [
    `# ${record.title ?? `Kairos ${record.scope}.${record.type}`}`,
    "",
    record.summary ? `Summary: ${record.summary}` : undefined,
    `Type: ${record.type}`,
    `Scope: ${record.scope}`,
    `Timestamp: ${timestamp}`,
    record.runId ? `Run ID: ${record.runId}` : undefined,
    record.branchId ? `Branch ID: ${record.branchId}` : undefined,
    record.lawId ? `Law ID: ${record.lawId}` : undefined,
    record.debateId ? `Debate ID: ${record.debateId}` : undefined,
    record.actor ? `Actor: ${record.actor}` : undefined,
    record.source ? `Source: ${record.source}` : undefined,
    record.content ? ["", record.content].join("\n") : undefined,
    data === undefined ? undefined : ["", "```json", JSON.stringify(data, null, 2), "```"].join("\n"),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(entry),
    ]),
  );
}

async function mirrorBestEffort(
  record: SupermemoryMirrorRecord,
  write: (record: SupermemoryMirrorRecord) => Promise<void>,
  options: Pick<SupermemoryMirrorOptions, "required" | "onError">,
): Promise<void> {
  try {
    await write(record);
  } catch (error) {
    await options.onError?.(error, record);
    if (options.required) {
      throw error;
    }
  }
}

function containerTagsForRecord(
  record: SupermemoryMirrorRecord,
  globalContainerTag: string,
): string[] {
  const tags = new Set<string>([globalContainerTag, ...(record.containerTags ?? [])]);
  if (record.branchId) {
    tags.add(getMemoryContainerTag({
      scopeId: record.branchId,
      prefix: "branch",
    }));
  }
  return [...tags];
}

function truncateContent(
  value: string,
  maxContentChars: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxContentChars) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, maxContentChars)}\n\n[TRUNCATED ${value.length - maxContentChars} chars]`,
    truncated: true,
  };
}

function compactMetadata(
  metadata: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    ),
  );
}

function safeCustomId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}
