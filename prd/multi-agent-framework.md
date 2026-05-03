# Multi-Agent Framework PRD

## 1. Purpose

Build the first Kairos multi-agent debate loop: an observable LangGraph workflow where specialist LangChain-compatible agents inspect an escalated market event, debate the bull and bear cases, gather evidence through tools, and produce a decision trail that a human can watch live and optionally interject into.

This is the first implementation slice for the larger Kairos inference system. It should not attempt to solve all routing, heartbeat, backtesting, notification, or trade execution problems yet. The goal is to make the deeper reasoning layer concrete, inspectable, and extensible.

## 2. Product Goals

- Make agent debates easy to observe while they are happening.
- Preserve every meaningful step: agent arguments, tool calls, tool results, judge plan updates, human context, and final synthesis.
- Let the human interject at any time without requiring participation.
- Prevent agents from calling or interrupting the human directly.
- Give debate agents access to a small tool surface: Exa search, Exa research, and a general information tool. Seed the debate with basic financials before it starts.
- Use LangGraph as the debate orchestration framework so the conversation can flow naturally while still being observable and bounded.
- Use LangChain-compatible model, tool, prompt, and structured-output abstractions for every model-backed debate participant and tool agent.
- Keep live trading out of scope. Debate outputs may recommend watch, notify, research further, or create paper-trade/trade-intent drafts only if later enabled.

## 3. Non-Goals

- Do not build live broker execution in this phase.
- Do not require a database in this phase.
- Do not build the full heartbeat scheduler in this phase.
- Do not make the human a required participant in the group chat.
- Do not let model agents block waiting for a human response.
- Do not optimize for every possible debate participant yet. Start with bull, bear, and judge.

## 4. Core User Experience

The UI should show the debate as a live discussion timeline.

The human sees:

- The summary passed in by the smaller model.
- The seeded basic financials.
- Each agent turn with identity, message type, argument, and confidence.
- Tool calls as visible expandable events.
- Tool results summarized with source metadata.
- The judge's orchestration decisions.
- Uncertainties and disagreement points.
- Final synthesis and recommendation.

The human can:

- Add contextual input at any time.

The human is not forced to:

- Approve every step.
- Answer agent questions.
- Join the debate.
- Stay online for the workflow to finish.

## 5. First Debate Shape

Version 1 should use four logical participants:

- `judge`: supervises the conversation, selects the next speaker, emits the current plan, decides when the debate should stop, and writes the final synthesis.
- `bull`: argues why the event may be materially positive or actionable.
- `bear`: argues why the event may be noise, already priced in, immaterial, risky, or negative.
- `human`: an optional participant whose messages are injected into the conversation when present.

The judge is not a passive summarizer. It owns orchestration.

Judge responsibilities:

- Read the initial debate summary and seeded basic financials.
- Select whether bull, bear, or the judge should speak next.
- Emit a lightweight current plan during the debate.
- Stop the debate when additional turns are unlikely to change the conclusion.
- Produce the final decision record only at the final action step.

Bull and bear responsibilities:

- Make one clear argument per turn.
- State confidence.
- Identify what would change their view.
- Call tools directly when they need specific information.
- Avoid pretending uncertainty is resolved when evidence is weak.

## 6. LangChain + LangGraph Architecture

The debate should be implemented as a LangGraph `StateGraph` made of LangChain-compatible agent/tool nodes. LangGraph should own state, routing, persistence, streaming, and replay. LangChain-compatible model/tool abstractions should handle model calls, tool binding, structured output, and tracing integration.

LangGraph's core model is:

- `State`: the shared conversation snapshot.
- `Nodes`: functions that read state and return partial state updates.
- `Edges`: fixed or conditional transitions that decide which node runs next.
- `Checkpoints`: saved state snapshots at graph step boundaries.
- `Threads`: persistent execution streams identified by `thread_id`.

This makes the debate observable because every node execution, state update, tool call, and routing decision can be streamed, logged, traced, and replayed.

### 6.1 Conversation Context

The conversation should carry enough context for observability and final synthesis:

```ts
type DebateConversationContext = {
  debateId: string;
  status: "running" | "paused" | "completed" | "failed";
  startInput: DebateStartInput;
  messages: DebateMessage[];
  toolEvents: ToolEvent[];
  currentPlan?: JudgePlan;
  humanInterjections: HumanInterjection[];
  finalDecision?: DebateDecision;
  budgets: DebateBudgets;
  createdAt: string;
  updatedAt: string;
};
```

This is the LangGraph state. It should stay minimal, but it must be explicit enough for durable execution, UI rendering, event replay, and final synthesis.

### 6.2 State Update Rules

State fields that accumulate over time should use reducers rather than manual mutation.

Recommended reducer behavior:

- `messages`: append-only.
- `toolEvents`: append-only.
- `humanInterjections`: append-only.
- `currentPlan`: replace with latest judge plan.
- `finalDecision`: set once at the final node.
- `budgets`: update counters after each model/tool step.

The implementation should avoid hiding important debate state inside opaque model messages. If the UI needs to render it, the state should preserve it explicitly.

### 6.3 Graph Nodes

- `judge`: selector/overseer agent. It emits current plan updates, chooses the next speaker, and decides when to terminate.
- `bull`: debate agent with direct tool access.
- `bear`: debate agent with direct tool access.
- `tools`: shared tool execution node for `exa_search`, `exa_research`, and `information`.
- `human_context`: optional state-ingest node that appends human context when present without blocking execution.
- `final`: judge final synthesis node.

All model-backed nodes should use LangChain-compatible abstractions. LangGraph owns control flow, state transitions, routing, retries, termination, and observability.

### 6.4 Conditional Edges

The graph should use conditional edges after agent nodes.

Recommended first graph:

```txt
START
  -> judge

judge
  -> bull
  -> bear
  -> human_context
  -> final
  -> END

bull
  -> tools, if bull emitted tool calls
  -> judge, otherwise

bear
  -> tools, if bear emitted tool calls
  -> judge, otherwise

tools
  -> judge

human_context
  -> judge

final
  -> END
```

Bull and bear can call tools directly in the sense that their model output can contain tool calls. LangGraph still routes those tool calls through the shared `tools` node so calls are typed, logged, retried, and rendered consistently.

### 6.5 Speaker Selection

The selector should choose the next speaker based on the conversation so far.

Allowed next-speaker decisions:

- `bull`
- `bear`
- `judge_plan`
- `judge_final`
- `stop`

The judge should not over-control the evidence flow. It should generally let bull and bear call tools directly and continue the discussion until it is time to stop.

### 6.6 Persistence and Replay

Compile the debate graph with a checkpointer from the start.

Local v1:

- Use an in-memory checkpointer only for throwaway tests.
- Prefer SQLite or local-file-compatible checkpointing for the local harness if available in the chosen JS package set.
- Always invoke runs with a stable `thread_id` equal to `debateId`.

Persistence is needed for:

- Recovering a debate after a crash.
- Replaying a debate from a checkpoint.
- Inspecting state history.
- Appending human context between graph steps.
- Comparing alternate debate paths later.

The local JSONL event log is still useful. LangGraph checkpoints preserve executable state; JSONL events preserve product-level audit history and UI replay.

### 6.7 Streaming

The debate runner should stream graph execution to the UI.

Use streaming modes that expose:

- Message/token chunks from model-backed nodes.
- State updates after each node.
- Tool call start/completion events.
- Checkpoint/task/debug events during development when useful.

The UI should subscribe to the debate stream and render:

- Current node.
- Current selected next speaker.
- Agent arguments.
- Tool calls and results.
- Budget counters.
- Final decision.

For local development, stream to both stdout and `events.jsonl`. For the web UI, expose the same events over SSE first unless WebSockets become necessary.

## 7. Observability Requirements

Every meaningful conversation step must emit an event.

Event types:

- `debate.started`
- `context.loaded`
- `agent.turn.started`
- `agent.message.created`
- `tool.call.started`
- `tool.call.completed`
- `tool.call.failed`
- `human.interjection.added`
- `judge.plan.updated`
- `speaker.selected`
- `debate.completed`
- `debate.failed`

Each event should include:

- `eventId`
- `debateId`
- `timestamp`
- `actor`
- `eventType`
- `payload`
- `parentEventId` when applicable
- `sourceRefs` when applicable

Persist events as append-only local JSONL initially. This keeps replay and UI streaming simple without requiring a database.

Suggested local layout:

```txt
data/
  debates/
    {debateId}/
      events.jsonl
      state.latest.json
      evidence/
```

### 7.1 LangSmith Tracing

Use LangSmith as the primary LangGraph tracing and observability backend unless the user chooses a self-hosted alternative later.

Required tracing setup:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<key>
LANGSMITH_PROJECT=kairos-debates
```

For LangChain.js in a non-serverless local/server process, set:

```bash
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

Each debate run should include trace metadata:

- `debateId`
- `lawId` if available
- `branchId` if available
- `ticker` if available
- `environment`
- `graphVersion`
- `model roles`

LangSmith should capture:

- Root debate run.
- Judge, bull, bear, final nodes.
- Tool node executions.
- LLM inputs/outputs where safe to log.
- Tool inputs/outputs where safe to log.
- Latency, token usage, and errors.

Sensitive or account-affecting information should be redacted before being sent to external observability systems.

### 7.2 Product Event Log

LangSmith traces are for debugging and model observability. Kairos still needs its own product event log.

The event log should be:

- Append-only.
- Local-first.
- Replayable by the UI.
- Independent of LangSmith availability.
- Safe to keep as part of the audit trail.

Do not rely only on LangSmith for product state, audit history, or user-facing replay.

### 7.3 Development Debugging

During development, enable the most verbose practical stream mode and inspect:

- Node order.
- Conditional edge decisions.
- State diffs after each node.
- Tool call inputs/results.
- Checkpoint history.
- Final decision shape.

When a debate behaves badly, the expected debugging path is:

1. Read the local `events.jsonl`.
2. Inspect the LangSmith trace.
3. Inspect the latest LangGraph checkpoint state.
4. Replay from the last useful checkpoint if needed.

## 8. Tool Layer

Tools should be typed and provider-isolated. Agents should call Kairos tools, not raw vendor clients.

The debate-facing tool layer should stay small. Bull and bear should see only three tools. Behind those tools, smaller retrieval/tool agents can handle API details, REST calls, Crawl4AI or Jina Reader, SEC lookups, company news, recent-news lookup, and formatting.

### 8.1 Required Tools

`exa_search`

- Purpose: normal web/source discovery through Exa.
- Input: natural-language query.
- Output: search results with URLs, snippets/summaries, and source metadata.

`exa_research`

- Purpose: deeper Exa research over a broader query.
- Input: natural-language research request.
- Output: research summary with citations/source URLs.

`information`

- Purpose: general retrieval interface for anything that is not plain Exa search or Exa research.
- Input: natural-language request.
- Output: concise answer, summary of tool work performed, citations/source URLs, and raw artifact references when available.
- Internal capabilities can include source reading through Crawl4AI or Jina Reader, company news, SEC filings, recent-news lookup, basic API lookups, and other retrieval tasks.

Basic financials are not a debate-facing tool in v1. They are seeded into the debate start input.

### 8.2 Tool Event Contract

Tool calls must be visible in the UI and replayable.

```ts
type ToolEvent = {
  toolEventId: string;
  debateId: string;
  toolName: "exa_search" | "exa_research" | "information";
  requestedBy: "judge" | "bull" | "bear";
  input: string;
  summary: string;
  outputRef?: string;
  citations: Citation[];
  status: "started" | "completed" | "failed";
  error?: string;
  startedAt: string;
  completedAt?: string;
};
```

## 9. Human Interjection Model

Human interjections are asynchronous conversation updates, not mandatory agent turns.

```ts
type HumanInterjection = {
  timestamp: string;
  summary: string;
};
```

Rules:

- The debate should pass human input to the agents as context only.
- Human input is not a decision, instruction, pause, stop, veto, or approval.
- Agents should treat human input as potentially useful but unverified.
- Any effect from human context should appear in later agent arguments or the final synthesis.

## 9.1 Debate Message Model

Each visible agent message should expose the information that matters to the UI without forcing separate claim objects.

```ts
type DebateMessage = {
  agentName: "judge" | "bull" | "bear" | "tool_agent";
  messageType: "argument" | "plan" | "tool_result" | "final";
  argument: string;
  confidence?: number;
};
```

## 10. Debate Decision Output

The final decision should be structured.

```ts
type DebateDecision = {
  summary: string;
  confidence: number;
  citations: Citation[];
};
```

The final action policy can be applied after this decision using the user's message and buy thresholds. Threshold state does not need to be part of the final decision schema.

## 10.1 Thresholded Action Policy

The judge must output a normalized confidence score that can drive user-configured actions.

There should be two primary user-configurable thresholds:

- `messageThreshold`: if the judge confidence is at or above this value, notify or message the human.
- `buyThreshold`: if the judge confidence is at or above this value, create a buy-side action according to the branch's permissions.

The buy threshold should be higher than the message threshold by default. Example defaults:

- `messageThreshold`: `0.65`
- `buyThreshold`: `0.85`

The threshold policy should be applied after the final decision.

```ts
type ThresholdActionPolicy = {
  confidenceScore: number;
  messageThreshold: number;
  buyThreshold: number;
  thresholdResult: "below_thresholds" | "message_human" | "buy_candidate";
  permittedAction: "record_only" | "message_human" | "paper_buy_intent" | "live_buy_intent_draft";
  liveTradingEnabled: boolean;
  rationale: string;
};
```

Rules:

- Confidence must represent the judge's belief that the event is actionable under the relevant law, not just confidence that the event happened.
- If `confidenceScore < messageThreshold`, the default action is record/watch only.
- If `messageThreshold <= confidenceScore < buyThreshold`, the default action is message the human.
- If `confidenceScore >= buyThreshold`, the system may create a buy candidate.
- A buy candidate should become a paper buy intent unless the branch, user, and environment have explicitly enabled live trading.
- A live buy threshold hit is still not an executed order. In this phase it can only create a `live_buy_intent_draft` requiring later approval and safety checks.
- Thresholds should be configurable globally and overrideable per law or branch.
- The UI should show the confidence score, thresholds, and selected action together so the human can see why the system chose to message, watch, or create a buy candidate.

## 11. Stopping Rules

The judge may stop the debate when:

- Bull and bear have each had at least one evidence-backed turn.
- The main uncertainties are captured in the final synthesis.
- Additional tool calls are unlikely to materially change the conclusion within the configured budget.
- The debate has hit max turns, max tool calls, max runtime, or max spend.

The judge should not stop only because both agents agree. It should check whether agreement is supported by evidence or caused by thin context.

## 12. Budgets and Safety

Each debate should have explicit budgets:

- Max turns.
- Max tool calls.
- Max wall-clock runtime.
- Max model spend estimate.
- Max external API calls.

Default version 1 budgets can be conservative:

- 1 initial judge plan.
- 1 bull turn.
- 1 bear turn.
- Up to 3 tool calls.
- 1 final judge synthesis.

The judge can request a continuation if the event appears unusually important, but continuation should be an explicit event and visible in the UI.

## 13. Data Inputs

Initial debate input should come from a smaller model calling the debate loop. It should be only the summary of what has been discussed or found so far, plus seeded basic financials.

```ts
type DebateStartInput = {
  summary: string;
  basicFinancials: BasicFinancials;
};
```

The summary can include the ticker, event, relevant source summaries, prior smaller-model reasoning, and anything else useful. Do not require a larger trigger schema for v1.

## 14. UI Requirements

The first UI does not need to be beautiful, but it must make the group chat visible.

Required views:

- Debate timeline.
- Agent-message stream.
- Tool-call stream.
- Evidence/source panel.
- Judge state panel showing current plan, selected speaker, budget usage, and stop conditions.
- Human input box that can submit without blocking the debate.

The UI should support live updates from the event log. Server-sent events or WebSockets are both acceptable; choose the simpler option once the frontend/runtime is selected.

## 15. Implementation Phases

### Phase 1: Local Debate Harness

- Define TypeScript schemas for debate context, events, messages, tools, evidence, and decisions.
- Implement a local LangChain + LangGraph `StateGraph` debate with judge, bull, bear, tools, human-context, and final nodes.
- Add conditional edges for judge speaker selection and bull/bear tool-call routing.
- Stub `exa_search`, `exa_research`, and `information` behind typed LangChain-compatible tools.
- Compile the graph with a checkpointer and run with `thread_id = debateId`.
- Stream node updates, messages, and tool events.
- Persist append-only product events to local JSONL.
- Enable LangSmith tracing for local debugging when credentials are present.
- Add a CLI or minimal local runner that starts a debate from a JSON debate-start input.

### Phase 2: Real Research Tools

- Add Exa normal search.
- Add Exa deep research.
- Add the `information` tool as the general interface for source reading, company news, SEC filings, recent-news lookup, and other retrieval tasks.
- Preserve raw outputs as local artifacts and summaries as event payloads.

### Phase 3: Live Observability UI

- Build a debate viewer over the event log.
- Stream debate events live.
- Add human interjection input.
- Add evidence/source inspection.
- Add links from each debate run to its LangSmith trace when tracing is enabled.
- Show current LangGraph node, selected next node, checkpoint status, and budget counters.

### Phase 4: Integration With Kairos Core Loop

- Connect smaller-model debate-start summaries into the debate harness.
- Connect branch/law context into recent debate context.
- Add final decision records back to branch memory.
- Add evaluation hooks for false positives and missed opportunities.

## 16. Open Questions

- Which LangChain JS packages and checkpointer package should be used for the first harness?
- Should the first UI be a web app, terminal UI, or both?
- Which Exa endpoints should be wrapped first for normal search and deep research?
- What should the first internal implementation of the `information` tool support?
- How should cost estimates be tracked before provider billing integrations exist?
- Should LangSmith be the only observability backend at first, or should we also keep an OpenTelemetry/Langfuse-compatible path available?

## 17. Acceptance Criteria

The first useful version is complete when:

- A developer can run one local debate from a debate-start summary seeded with basic financials.
- The debate uses a LangGraph `StateGraph` with judge, bull, bear, tools, human-context, and final nodes.
- Conditional edges route bull/bear tool calls through the tools node and route judge decisions to the next participant or final node.
- Bull, bear, and judge messages are distinguishable.
- Tool calls are typed, logged, and visible as events, even if some are stubbed.
- Debate-facing tools are limited to `exa_search`, `exa_research`, and `information`.
- Human interjections can be appended while the debate is running and considered at the next checkpoint.
- The debate produces a structured final decision.
- The final decision includes only summary, confidence, and citations.
- The entire run can be replayed from local event logs.
- LangSmith tracing can be enabled with environment variables and includes node/tool/model spans.
