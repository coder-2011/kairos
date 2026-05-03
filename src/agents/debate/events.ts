import { z } from "zod";

import {
  debateDecisionSchema,
  debateMessageSchema,
  debateToolEventSchema,
  humanInterjectionSchema,
  judgePlanSchema,
} from "./schema.js";
import type {
  DebateDecision,
  DebateMessage,
  DebateToolEvent,
  HumanInterjection,
  JudgePlan,
} from "./types.js";

export const debateEventSchema = z
  .object({
    eventId: z.string(),
    debateId: z.string(),
    timestamp: z.string(),
    actor: z.string(),
    eventType: z.enum([
      "debate.started",
      "context.loaded",
      "agent.message.created",
      "tool.call.completed",
      "tool.call.failed",
      "human.interjection.added",
      "judge.plan.updated",
      "speaker.selected",
      "debate.completed",
      "debate.failed",
    ]),
    payload: z.unknown(),
    parentEventId: z.string().optional(),
    sourceRefs: z.array(z.string()).optional(),
  })
  .strict();

export type DebateEvent = z.infer<typeof debateEventSchema>;

export type DebateEventFactoryOptions = {
  id: () => string;
  now: () => Date;
};

export function createDebateEvent(
  input: Omit<DebateEvent, "eventId" | "timestamp">,
  options: DebateEventFactoryOptions,
): DebateEvent {
  return debateEventSchema.parse({
    ...input,
    eventId: options.id(),
    timestamp: options.now().toISOString(),
  });
}

export function createDebateStartedEvent(
  debateId: string,
  payload: unknown,
  options: DebateEventFactoryOptions,
): DebateEvent {
  return createDebateEvent(
    {
      debateId,
      actor: "system",
      eventType: "debate.started",
      payload,
    },
    options,
  );
}

export function createMessageEvent(
  debateId: string,
  message: DebateMessage,
  options: DebateEventFactoryOptions,
): DebateEvent {
  const parsed = debateMessageSchema.parse(message);
  return createDebateEvent(
    {
      debateId,
      actor: parsed.agentName,
      eventType:
        parsed.messageType === "plan"
          ? "judge.plan.updated"
          : parsed.messageType === "final"
            ? "debate.completed"
            : "agent.message.created",
      payload: parsed,
    },
    options,
  );
}

export function createToolEvent(
  event: DebateToolEvent,
  options: DebateEventFactoryOptions,
): DebateEvent {
  const parsed = debateToolEventSchema.parse(event);
  return createDebateEvent(
    {
      debateId: parsed.debateId,
      actor: parsed.requestedBy,
      eventType:
        parsed.status === "failed" ? "tool.call.failed" : "tool.call.completed",
      payload: parsed,
      sourceRefs: parsed.citations.map((citation) => citation.url),
    },
    options,
  );
}

export function createHumanInterjectionEvent(
  debateId: string,
  interjection: HumanInterjection,
  options: DebateEventFactoryOptions,
): DebateEvent {
  return createDebateEvent(
    {
      debateId,
      actor: "human",
      eventType: "human.interjection.added",
      payload: humanInterjectionSchema.parse(interjection),
    },
    options,
  );
}

export function createJudgePlanEvent(
  debateId: string,
  plan: JudgePlan,
  options: DebateEventFactoryOptions,
): DebateEvent {
  return createDebateEvent(
    {
      debateId,
      actor: "judge",
      eventType: "speaker.selected",
      payload: judgePlanSchema.parse(plan),
    },
    options,
  );
}

export function createFinalDecisionEvent(
  debateId: string,
  decision: DebateDecision,
  options: DebateEventFactoryOptions,
): DebateEvent {
  return createDebateEvent(
    {
      debateId,
      actor: "judge",
      eventType: "debate.completed",
      payload: debateDecisionSchema.parse(decision),
      sourceRefs: decision.citations.map((citation) => citation.url),
    },
    options,
  );
}
