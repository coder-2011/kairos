import { describe, expect, it, vi } from "vitest";

import { runDebateAgent, streamDebateAgentUpdates } from "./agent.js";
import {
  createDebateStartedEvent,
  createFinalDecisionEvent,
  createMessageEvent,
  createToolEvent,
} from "./events.js";
import type {
  DebateAgentOutput,
  DebateDecision,
  JudgePlan,
  StructuredDebateModelProvider,
} from "./types.js";

const fixedNow = new Date("2026-05-03T12:00:00.000Z");

const startInput = {
  summary:
    "A smaller model found a potentially material PLTR contract headline and wants a debate.",
  basicFinancials: {
    ticker: "PLTR",
    marketCap: "example",
    revenueGrowth: "example",
  },
};

function fakeStructuredModel<T>(output: T): StructuredDebateModelProvider {
  return {
    withStructuredOutput: <U>() => ({
      invoke: async (): Promise<U> => output as unknown as U,
    }),
  };
}

describe("debate agent", () => {
  it("runs the deterministic LangGraph debate with a tool call and final decision", async () => {
    const information = vi.fn(async () => ({
      summary: "Information tool checked the reported contract context.",
      citations: [
        {
          title: "Example source",
          url: "https://example.com/pltr-contract",
        },
      ],
    }));

    const result = await runDebateAgent(
      {
        debateId: "debate-pltr-1",
        startInput,
      },
      {
        now: () => fixedNow,
        id: () => "tool-event-1",
        tools: {
          information,
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.messages.map((message) => message.agentName)).toEqual([
      "judge",
      "bull",
      "tool_agent",
      "judge",
      "bear",
      "judge",
      "judge",
    ]);
    expect(information).toHaveBeenCalledWith(
      expect.stringContaining("PLTR contract headline"),
      expect.objectContaining({
        debateId: "debate-pltr-1",
        requestedBy: "bull",
        startInput,
      }),
    );
    expect(result.toolEvents).toEqual([
      expect.objectContaining({
        toolEventId: "tool-event-1",
        debateId: "debate-pltr-1",
        toolName: "information",
        requestedBy: "bull",
        status: "completed",
        summary: "Information tool checked the reported contract context.",
      }),
    ]);
    expect(result.finalDecision).toEqual({
      summary: "Final synthesis based on 6 messages and 1 tool result(s).",
      confidence: 0.5,
      citations: [
        {
          title: "Example source",
          url: "https://example.com/pltr-contract",
        },
      ],
    });
  });

  it("uses injected structured models for judge, participants, and final synthesis", async () => {
    const judge = fakeStructuredModel<JudgePlan>({
      plan: "Send bear directly to final after one response.",
      nextNode: "bear",
    });
    const bear = fakeStructuredModel<DebateAgentOutput>({
      argument: "Bear case: this may already be priced in.",
      confidence: 0.72,
      toolRequest: null,
    });
    const final = fakeStructuredModel<DebateDecision>({
      summary: "Final: watch only.",
      confidence: 0.61,
      citations: [],
    });

    const result = await runDebateAgent(
      {
        debateId: "debate-models-1",
        startInput,
        budgets: {
          maxTurns: 1,
        },
      },
      {
        models: {
          judge,
          bear,
          final,
        },
        now: () => fixedNow,
      },
    );

    expect(result.messages).toEqual([
      {
        agentName: "judge",
        messageType: "plan",
        argument: "Send bear directly to final after one response.",
      },
      {
        agentName: "bear",
        messageType: "argument",
        argument: "Bear case: this may already be priced in.",
        confidence: 0.72,
      },
      {
        agentName: "judge",
        messageType: "plan",
        argument: "Send bear directly to final after one response.",
      },
      {
        agentName: "judge",
        messageType: "final",
        argument: "Final: watch only.",
        confidence: 0.61,
      },
    ]);
    expect(result.finalDecision).toEqual({
      summary: "Final: watch only.",
      confidence: 0.61,
      citations: [],
    });
  });

  it("passes human interjections through as unverified context", async () => {
    const result = await runDebateAgent(
      {
        debateId: "debate-human-1",
        startInput,
        humanInterjections: [
          {
            timestamp: "2026-05-03T12:01:00.000Z",
            summary: "Human thinks the source may be promotional.",
          },
        ],
      },
      {
        now: () => fixedNow,
      },
    );

    expect(result.humanInterjections).toEqual([
      {
        timestamp: "2026-05-03T12:01:00.000Z",
        summary: "Human thinks the source may be promotional.",
      },
    ]);
  });

  it("streams LangGraph node updates for observability", async () => {
    const chunks = [];

    for await (const chunk of streamDebateAgentUpdates(
      {
        debateId: "debate-stream-1",
        startInput,
      },
      {
        now: () => fixedNow,
        id: () => "stream-tool-event-1",
      },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => "judge" in chunk)).toBe(true);
    expect(chunks.some((chunk) => "final" in chunk)).toBe(true);
  });

  it("creates product-level events from debate messages and tool results", async () => {
    const options = {
      id: vi
        .fn()
        .mockReturnValueOnce("event-1")
        .mockReturnValueOnce("event-2")
        .mockReturnValueOnce("event-3")
        .mockReturnValueOnce("event-4"),
      now: () => fixedNow,
    };

    const started = createDebateStartedEvent(
      "debate-events-1",
      { startInput },
      options,
    );
    const message = createMessageEvent(
      "debate-events-1",
      {
        agentName: "bull",
        messageType: "argument",
        argument: "Bull case.",
        confidence: 0.7,
      },
      options,
    );
    const tool = createToolEvent(
      {
        toolEventId: "tool-event-1",
        debateId: "debate-events-1",
        toolName: "information",
        requestedBy: "bull",
        input: "Check source",
        summary: "Source checked.",
        citations: [{ url: "https://example.com/source" }],
        status: "completed",
        startedAt: fixedNow.toISOString(),
        completedAt: fixedNow.toISOString(),
      },
      options,
    );
    const final = createFinalDecisionEvent(
      "debate-events-1",
      {
        summary: "Final summary.",
        confidence: 0.75,
        citations: [{ url: "https://example.com/source" }],
      },
      options,
    );

    expect(started).toMatchObject({
      eventId: "event-1",
      eventType: "debate.started",
      actor: "system",
    });
    expect(message).toMatchObject({
      eventId: "event-2",
      eventType: "agent.message.created",
      actor: "bull",
    });
    expect(tool).toMatchObject({
      eventId: "event-3",
      eventType: "tool.call.completed",
      sourceRefs: ["https://example.com/source"],
    });
    expect(final).toMatchObject({
      eventId: "event-4",
      eventType: "debate.completed",
      sourceRefs: ["https://example.com/source"],
    });
  });
});
