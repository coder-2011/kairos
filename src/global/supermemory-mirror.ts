import type { DebateRunResult } from "../agents/debate/types.js";
import type { InformationResult } from "../agents/information/types.js";
import type { GlobalMemoryApi } from "./memory.js";
import { GLOBAL_MEMORY_CONTAINER_TAG, getMemoryContainerTag } from "./memory.js";
import type { AgentObserver } from "./observability.js";
import { recordProviderUsage } from "./usage.js";

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
  maxMemoryChars?: number;
  maxContainerTags?: number;
  /**
   * `memory` keeps mirrored records cheap: one compact memory per logical
   * record. Use `document` only for records where full source text is worth
   * indexing.
   */
  writeMode?: "memory" | "document" | "both";
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

const DEFAULT_MAX_CONTENT_CHARS = 4_000;
const DEFAULT_MAX_MEMORY_CHARS = 900;
const DEFAULT_MAX_CONTAINER_TAGS = 1;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key)/i;
const SECRET_TEXT_PATTERN =
  /\b(api[_-]?key|token|secret|password|authorization|bearer|cookie|session|private[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\n,}]+)/gi;

export function createSupermemoryMirror(
  options: SupermemoryMirrorOptions,
): SupermemoryMirror {
  const globalContainerTag =
    options.globalContainerTag ?? GLOBAL_MEMORY_CONTAINER_TAG;
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const maxMemoryChars = options.maxMemoryChars ?? DEFAULT_MAX_MEMORY_CHARS;
  const maxContainerTags = options.maxContainerTags ?? DEFAULT_MAX_CONTAINER_TAGS;
  const writeMode = options.writeMode ?? "memory";

  const write = async (record: SupermemoryMirrorRecord): Promise<void> => {
    const tags = primaryContainerTagsForRecord(
      record,
      globalContainerTag,
      maxContainerTags,
    );
    const content = truncateContent(formatMirrorRecord(record), maxContentChars);
    const memoryContent = truncateText(compactMemoryForRecord(record), maxMemoryChars);
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

    await recordMirrorEstimate(record, {
      containerCount: tags.length,
      contentChars: content.value.length,
      memoryChars: memoryContent.length,
      writeMode,
    });

    await Promise.all(
      tags.flatMap((containerTag) => {
        const writes: Array<Promise<unknown>> = [];
        if (writeMode === "document" || writeMode === "both") {
          writes.push(
            options.memory.addContent({
              containerTag,
              customId: safeCustomId(customIdForRecord(record)),
              content: content.value,
              metadata,
              entityContext: entityContextForRecord(record),
            }),
          );
        }
        if (writeMode === "memory" || writeMode === "both") {
          writes.push(
            options.memory.createMemories({
              containerTag,
              memories: [
                {
                  content: memoryContent,
                  isStatic: false,
                  metadata,
                },
              ],
            }),
          );
        }
        return writes;
      }),
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
        const memoryContent = truncateText(compactMemoryForRecord(mirroredRecord), maxMemoryChars);
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
        const containerTags = primaryContainerTagsForRecord(
          mirroredRecord,
          globalContainerTag,
          maxContainerTags,
        );
        await recordMirrorEstimate(mirroredRecord, {
          containerCount: containerTags.length,
          contentChars: content.value.length,
          memoryChars: memoryContent.length,
          writeMode,
        });
        await Promise.all(
          containerTags.flatMap((containerTag) => {
            const writes: Array<Promise<unknown>> = [];
            if (writeMode === "document" || writeMode === "both") {
              writes.push(
                options.memory.writeConversation({
                  containerTag,
                  customId: safeCustomId(mirroredRecord.customId ?? `kairos:debate:${result.debateId}:transcript`),
                  content: content.value,
                  messages: transcriptMessages,
                  metadata,
                }),
              );
            }
            if (writeMode === "memory" || writeMode === "both") {
              writes.push(
                options.memory.createMemories({
                  containerTag,
                  memories: [
                    {
                      content: memoryContent,
                      isStatic: false,
                      metadata,
                    },
                  ],
                }),
              );
            }
            return writes;
          }),
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

function primaryContainerTagsForRecord(
  record: SupermemoryMirrorRecord,
  globalContainerTag: string,
  maxContainerTags: number,
): string[] {
  const tags = containerTagsForRecord(record, globalContainerTag);
  const sorted = [...tags].sort(
    (left, right) => tagPriority(left, globalContainerTag) - tagPriority(right, globalContainerTag),
  );
  return sorted.slice(0, Math.max(1, maxContainerTags));
}

function tagPriority(tag: string, globalContainerTag: string): number {
  if (tag.includes("profile")) return 0;
  if (tag !== globalContainerTag) return 1;
  return 2;
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
    entityPurposeForRecord(record),
    record.scope ? `Scope: ${record.scope}.` : undefined,
    record.type ? `Type: ${record.type}.` : undefined,
    record.branchId ? `Branch ID: ${record.branchId}.` : undefined,
    record.lawId ? `Law ID: ${record.lawId}.` : undefined,
    record.runId ? `Run ID: ${record.runId}.` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function entityPurposeForRecord(record: SupermemoryMirrorRecord): string {
  switch (record.scope) {
    case "branch":
      return "This is a branch-specific monitoring lane; preserve its law, watched assets, thesis, false positives, escalation history, and user corrections.";
    case "heartbeat":
      return "This is a lightweight branch heartbeat check; use it for recurring evidence patterns, trigger quality, and escalation context.";
    case "debate":
      return "This is an escalation debate or synthesis record; preserve the evidence, disagreement, final decision, uncertainty, and cited rationale.";
    case "information":
      return "This is a market information lookup; use it as a source-backed context summary, not as a trade execution instruction.";
    case "trade_intent":
      return "This is a proposed trade intent for human review, not an executed order.";
    case "portfolio":
      return "This is account or portfolio state; zero positions can be a valid state, and snapshots should be treated as context rather than market evidence.";
    case "agent_observation":
      return "This is an observability trace; use it lightly for debugging agent behavior, not as factual market evidence.";
    default:
      return "Use this record as Kairos context, and corroborate public market claims with current public sources before relying on them.";
  }
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

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()} [TRUNCATED ${value.length - maxChars} chars]`;
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

async function recordMirrorEstimate(
  record: SupermemoryMirrorRecord,
  input: {
    containerCount: number;
    contentChars: number;
    memoryChars: number;
    writeMode: NonNullable<SupermemoryMirrorOptions["writeMode"]>;
  },
): Promise<void> {
  const documentWrites =
    input.writeMode === "document" || input.writeMode === "both"
      ? input.containerCount
      : 0;
  const memoryWrites =
    input.writeMode === "memory" || input.writeMode === "both"
      ? input.containerCount
      : 0;
  const estimatedTokens =
    documentWrites * estimateTokens(input.contentChars) +
    memoryWrites * estimateTokens(input.memoryChars);

  await recordProviderUsage({
    provider: "supermemory",
    operation: "mirror.estimate",
    status: "unknown",
    runId: record.runId,
    branchId: record.branchId,
    quotaUnits: estimatedTokens,
    unit: "estimated_tokens",
    metadata: {
      type: record.type,
      scope: record.scope,
      containerCount: input.containerCount,
      documentWrites,
      memoryWrites,
      contentChars: input.contentChars,
      memoryChars: input.memoryChars,
      writeMode: input.writeMode,
    },
  });
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
