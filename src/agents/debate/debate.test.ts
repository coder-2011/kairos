import { describe, expect, it, vi } from "vitest";

import { runDebateAgent, streamDebateAgentUpdates } from "./agent.js";
import {
  createDebateStartedEvent,
  createFinalDecisionEvent,
  createMessageEvent,
  createToolEvent,
} from "./events.js";
import { resolveDebatePrompts } from "./prompt.js";
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

function queuedStructuredModel<T>(outputs: T[]) {
  const invoke = vi.fn(async (): Promise<unknown> => {
    const output = outputs.shift();

    if (output === undefined) {
      throw new Error("No queued structured model output.");
    }

    return output;
  });

  return {
    invoke,
    model: {
      withStructuredOutput: <U>() => ({
        invoke: invoke as unknown as (input: unknown) => Promise<U>,
      }),
    } satisfies StructuredDebateModelProvider,
  };
}

function firstSystemPrompt(invoke: ReturnType<typeof vi.fn>): unknown {
  const input = invoke.mock.calls[0]?.[0];

  if (!Array.isArray(input)) {
    return undefined;
  }

  return (input[0] as { content?: unknown } | undefined)?.content;
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
        allowDeterministicFallback: true,
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
      "tool_agent",
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
      expect.objectContaining({
        toolEventId: "tool-event-1",
        debateId: "debate-pltr-1",
        toolName: "information",
        requestedBy: "bear",
        status: "completed",
        summary: "Information tool checked the reported contract context.",
      }),
    ]);
    expect(result.finalDecision).toEqual({
      summary: "Final synthesis based on 7 messages and 2 tool result(s).",
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

  it("uses configured system prompts for judge, bull, bear, and final synthesis", async () => {
    const judge = queuedStructuredModel<JudgePlan>([
      { plan: "Custom route to bull.", nextNode: "bull" },
      { plan: "Custom route to bear.", nextNode: "bear" },
      { plan: "Custom route to final.", nextNode: "final" },
    ]);
    const bull = queuedStructuredModel<DebateAgentOutput>([
      {
        argument: "Bull case from custom prompt.",
        confidence: 0.67,
        toolRequest: null,
      },
    ]);
    const bear = queuedStructuredModel<DebateAgentOutput>([
      {
        argument: "Bear case from custom prompt.",
        confidence: 0.58,
        toolRequest: null,
      },
    ]);
    const final = queuedStructuredModel<DebateDecision>([
      {
        summary: "Final from custom prompt.",
        confidence: 0.63,
        citations: [],
      },
    ]);

    await runDebateAgent(
      {
        debateId: "debate-prompts-1",
        startInput,
        budgets: {
          maxTurns: 2,
        },
      },
      {
        models: {
          judge: judge.model,
          bull: bull.model,
          bear: bear.model,
          final: final.model,
        },
        prompts: {
          judgeSystemPrompt: "CUSTOM JUDGE SYSTEM",
          bullSystemPrompt: "CUSTOM BULL SYSTEM",
          bearSystemPrompt: "CUSTOM BEAR SYSTEM",
          finalSystemPrompt: "CUSTOM FINAL SYSTEM",
        },
        now: () => fixedNow,
      },
    );

    expect(firstSystemPrompt(judge.invoke)).toBe("CUSTOM JUDGE SYSTEM");
    expect(firstSystemPrompt(bull.invoke)).toBe("CUSTOM BULL SYSTEM");
    expect(firstSystemPrompt(bear.invoke)).toBe("CUSTOM BEAR SYSTEM");
    expect(firstSystemPrompt(final.invoke)).toBe("CUSTOM FINAL SYSTEM");
  });

  it("resolves configurable debate system prompts from the environment", () => {
    expect(
      resolveDebatePrompts({
        KAIROS_DEBATE_JUDGE_SYSTEM_PROMPT: "ENV JUDGE",
        KAIROS_DEBATE_BULL_SYSTEM_PROMPT: "ENV BULL",
        KAIROS_DEBATE_BEAR_SYSTEM_PROMPT: "ENV BEAR",
        KAIROS_DEBATE_FINAL_SYSTEM_PROMPT: "ENV FINAL",
      }),
    ).toEqual({
      judgeSystemPrompt: "ENV JUDGE",
      bullSystemPrompt: "ENV BULL",
      bearSystemPrompt: "ENV BEAR",
      finalSystemPrompt: "ENV FINAL",
    });
    expect(resolveDebatePrompts({})).toBeUndefined();
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
        allowDeterministicFallback: true,
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
        allowDeterministicFallback: true,
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
