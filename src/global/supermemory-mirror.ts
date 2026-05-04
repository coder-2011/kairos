import type { DebateRunResult } from "../agents/debate/types.js";
import type { InformationResult } from "../agents/information/types.js";
import type { GlobalMemoryApi } from "./memory.js";
import { GLOBAL_MEMORY_CONTAINER_TAG, getMemoryContainerTag } from "./memory.js";
import type { AgentObserver } from "./observability.js";

export type SupermemoryMirrorTarget = Pick<
  GlobalMemoryApi,
  "addContent" | "createMemories" | "writeConversation"
>;

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
const SECRET_TEXT_PATTERN =
  /\b(api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\n,}]+)/gi;

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
      tags.flatMap((containerTag) => [
        options.memory.addContent({
          containerTag,
          customId: safeCustomId(customIdForRecord(record)),
          content: content.value,
          metadata,
          entityContext: entityContextForRecord(record),
        }),
        options.memory.createMemories({
          containerTag,
          memories: [
            {
              content: compactMemoryForRecord(record),
              isStatic: false,
              metadata,
            },
          ],
        }),
      ]),
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
        const metadata = compactMetadata({
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
        });
        await Promise.all(
          containerTagsForRecord(mirroredRecord, globalContainerTag).flatMap(
            (containerTag) => [
              options.memory.writeConversation({
                containerTag,
                customId: safeCustomId(mirroredRecord.customId ?? `kairos:debate:${result.debateId}:transcript`),
                content: content.value,
                messages: transcriptMessages,
                metadata,
              }),
              options.memory.createMemories({
                containerTag,
                memories: [
                  {
                    content: compactMemoryForRecord(mirroredRecord),
                    isStatic: false,
                    metadata,
                  },
                ],
              }),
            ],
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

export function createSupermemoryObserver(
  mirror: SupermemoryMirror,
): AgentObserver {
  return {
    event: (event) =>
      mirror.mirrorRecord({
        type: event.type,
        scope: "agent_observation",
        timestamp: event.timestamp,
        runId: event.runId,
        branchId: event.branchId,
        actor: event.agent,
        source: "agent_observer",
        title: `Kairos ${event.agent} observation ${event.type}`,
        summary: event.type,
        data: event,
        customId: `kairos:agent_observation:${event.runId ?? event.agent}:${event.type}:${event.timestamp}`,
      }),
  };
}

export function formatMirrorRecord(record: SupermemoryMirrorRecord): string {
  const timestamp = record.timestamp ?? new Date().toISOString();
  const data = redactSecrets(record.data);
  return [
    `# ${redactText(record.title ?? `Kairos ${record.scope}.${record.type}`)}`,
    "",
    record.summary ? `Summary: ${redactText(record.summary)}` : undefined,
    `Type: ${record.type}`,
    `Scope: ${record.scope}`,
    `Timestamp: ${timestamp}`,
    record.runId ? `Run ID: ${record.runId}` : undefined,
    record.branchId ? `Branch ID: ${record.branchId}` : undefined,
    record.lawId ? `Law ID: ${record.lawId}` : undefined,
    record.debateId ? `Debate ID: ${record.debateId}` : undefined,
    record.actor ? `Actor: ${record.actor}` : undefined,
    record.source ? `Source: ${record.source}` : undefined,
    record.content ? ["", redactText(record.content)].join("\n") : undefined,
    data === undefined ? undefined : ["", "```json", JSON.stringify(data, null, 2), "```"].join("\n"),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (typeof value === "string") {
    return redactText(value);
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

export function redactText(value: string): string {
  return value.replace(SECRET_TEXT_PATTERN, (match, key: string) => `${key}=[REDACTED]`);
}

async function mirrorBestEffort(
  record: SupermemoryMirrorRecord,
  write: (record: SupermemoryMirrorRecord) => Promise<void>,
  options: Pick<SupermemoryMirrorOptions, "required" | "onError">,
): Promise<void> {
  try {
    await write(record);
  } catch (error) {
    try {
      await options.onError?.(error, record);
    } catch {
      // Reporting failures must not override best-effort mirror behavior.
    }
    if (options.required) {
      throw error;
    }
  }
}

function containerTagsForRecord(
  record: SupermemoryMirrorRecord,
  globalContainerTag: string,
): string[] {
  const configuredTags = record.containerTags ?? [];
  const tags = new Set<string>([globalContainerTag, ...configuredTags]);
  if (record.branchId && configuredTags.length === 0) {
    tags.add(getMemoryContainerTag({
      scopeId: record.branchId,
      prefix: "branch",
    }));
    tags.add(getMemoryContainerTag({
      scopeId: record.branchId,
      prefix: "branch_profile",
    }));
  }
  return [...tags];
}

function customIdForRecord(record: SupermemoryMirrorRecord): string {
  return (
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
      .join(":")
  );
}

function entityContextForRecord(record: SupermemoryMirrorRecord): string {
  return [
    "Kairos is a human-steered trading research system.",
    "This record is part of Kairos persistent agent memory.",
    record.scope ? `Scope: ${record.scope}.` : undefined,
    record.type ? `Type: ${record.type}.` : undefined,
    record.branchId ? `Branch ID: ${record.branchId}.` : undefined,
    record.lawId ? `Law ID: ${record.lawId}.` : undefined,
    record.runId ? `Run ID: ${record.runId}.` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function compactMemoryForRecord(record: SupermemoryMirrorRecord): string {
  return redactText(
    [
      `Kairos ${record.scope}.${record.type}`,
      record.branchId ? `branch=${record.branchId}` : undefined,
      record.lawId ? `law=${record.lawId}` : undefined,
      record.runId ? `run=${record.runId}` : undefined,
      record.summary ?? record.title,
    ]
      .filter((part): part is string => Boolean(part))
      .join(": "),
  );
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
