# Organizational Context

## Purpose

Kairos is a human-maintained trading-agent system organized around explicit market laws, branch-level monitoring, and auditable escalation from cheap monitoring to deeper research and debate.

The system should help the human encode market intuition into durable infrastructure. It should not replace human judgment with an opaque autonomous trading bot. Every important belief update, escalation, debate, notification, paper trade, or trade intent should be inspectable and replayable.

## Operating Model

Kairos is organized as a hierarchy of responsibility:

1. The human writes and updates laws.
2. Each law creates one or more branches.
3. Heartbeat agents monitor branches frequently and cheaply.
4. Lightweight gates filter heartbeat findings before expensive reasoning.
5. Big research and debate agents investigate only events that justify more work.
6. The system records evidence, reasoning, uncertainty, disagreement, decisions, and outcomes.
7. The human reviews, corrects, and improves the laws, branch settings, and agent behavior over time.

The system is not designed around one global agent. It is designed around many small, inspectable monitoring lanes that can escalate selectively.

## Core Organizational Units

### Law

A law is the primary human-authored unit of market logic.

A law defines:

- The phenomenon to watch.
- Why the phenomenon could matter.
- Which assets, companies, sectors, or instruments are in scope.
- What counts as high-information evidence.
- Which sources matter.
- What should be ignored.
- When escalation is justified.
- Whether the branch may notify, propose paper trades, or draft trade intents.

Laws should be portable, versioned, and represented as data plus instructions. They should not be hidden in agent code.

### Branch

A branch is a running monitoring lane bound to a law.

A branch owns:

- Branch configuration.
- Heartbeat cadence and model configuration.
- Seeded data settings.
- Source preferences and exclusions.
- Memory scope.
- Recent observations.
- Escalation history.
- Evaluation records.

Branches should be independently enabled, disabled, forked, replayed, and evaluated.

### Event

Events are the durable backbone of the system.

Every meaningful action should become an append-only event:

- Law created or updated.
- Branch created or updated.
- Source ingested.
- Heartbeat run completed.
- Heartbeat trigger produced.
- Gate decision made.
- Escalation opened or closed.
- Research step completed.
- Debate message created.
- Tool call started or completed.
- Human interjection added.
- Decision produced.
- Paper trade or trade intent drafted.
- Outcome recorded.

Events are the canonical record. Agent memory, summaries, UI state, and future analytics should be derived from events whenever possible.

### Memory

Memory is the semantic recall layer, not the source of truth.

Supermemory should help agents retrieve:

- Stable law and branch facts.
- Recent branch activity.
- Prior triggers and false positives.
- Human corrections and preferences.
- Prior debate outcomes.
- Related historical events.
- Cross-law patterns.

Supermemory should not be the only place where important system state exists. Kairos should write important facts first to local append-only records, then mirror distilled memories into Supermemory for retrieval.

The practical rule is:

> Local events are the ledger. Supermemory is the recall layer.

## Memory Scoping

Memory should be scoped so agents retrieve the right context without blending unrelated laws or branches.

Recommended Supermemory container tags:

- `branch:{branchId}` for branch-specific operational memory.
- `law:{lawId}` for durable law-level knowledge.
- `asset:{ticker}` for cross-law asset context.
- `system:global` for human preferences and system-level learnings.
- `system:debates` for debate transcripts, decisions, and outcomes.

The current heartbeat implementation derives a branch-level Supermemory container tag from `BranchConfig.memory.supermemoryContainerTag` when provided, otherwise from the branch ID. That behavior should remain compatible with the broader scoping strategy.

## Agent Layers

### Heartbeat Agents

Heartbeat agents are cheap, frequent monitors.

They should:

- Read the law and branch configuration.
- Read seeded recent context.
- Retrieve branch memory when useful.
- Identify potentially new, relevant, high-entropy evidence.
- Produce a compact heartbeat output.

They should not:

- Make final investment recommendations.
- Execute trades.
- Run deep research.
- Escalate routine noise.

### Gate Agents

Gate agents sit between heartbeat triggers and expensive research.

They should evaluate:

- Novelty.
- Source credibility.
- Law relevance.
- Duplicate or stale information.
- Plausible materiality.
- Budget level for further work.

Every gate should emit a decision and rationale.

### Big Research Agents

Big research agents investigate escalated events.

They should query deeper sources, market context, historical comparables, and current price behavior. Their job is to decide whether the event deserves notification, debate, continued monitoring, or a draft paper trade or trade intent.

### Debate Agents

Debate agents provide structured disagreement.

The initial debate organization is:

- `judge`: selects the next speaker, maintains the plan, decides when to stop, and writes the final synthesis.
- `bull`: argues why an event may be material or actionable.
- `bear`: argues why an event may be noise, priced in, immaterial, risky, or negative.
- `human`: optional contextual input, treated as useful but unverified context.

Debates should preserve messages, tool calls, citations, disagreement points, final decisions, and human interjections.

## Tool and Provider Boundaries

Provider integrations should be isolated behind Kairos interfaces.

Current provider roles:

- OpenRouter for model calls.
- LangChain for model, prompt, tool, and structured-output abstractions.
- LangGraph for agent workflow orchestration.
- Exa for online search and research.
- Supermemory for persistent semantic memory.
- Finnhub for planned market data.
- Alpaca for planned brokerage and possible live ticker data.

Agents should call Kairos tools and adapters, not raw vendor clients directly. This keeps the system testable, replayable, and easier to change.

## Persistence Strategy

Initial persistence should remain local-file based.

Recommended local layout:

```txt
data/
  laws/
  branches/
  events/
  escalations/
  debates/
  corpora/
  recent-windows/
  artifacts/
  audit/
```

Local persistence should favor:

- Append-only JSONL for event streams.
- JSON snapshots for latest state.
- Durable source artifacts where citations or replay require them.
- No secrets in `data/`.

A database should be added only when local files become a real bottleneck.

## Observability and Replay

Kairos should optimize for inspectability.

Each workflow should expose:

- Input state.
- Model outputs.
- Tool calls and results.
- Source metadata and citations.
- Confidence and uncertainty.
- Gate rationales.
- Debate transcripts.
- Final decisions.
- Human corrections.

LangSmith can be used for LangGraph tracing when credentials are present. Local product event logs remain the audit and UI replay source.

## Trading Safety Boundary

Trading is a high-risk boundary.

Kairos should default to:

- Research.
- Simulation.
- Notifications.
- Paper trades.
- Draft trade intents.

Live broker orders must not be implemented or enabled unless the human explicitly asks for that in the same turn and the implementation includes explicit safeguards.

Every trade intent should include:

- Law and branch origin.
- Triggering evidence.
- Source citations.
- Reasoning.
- Confidence.
- Risk.
- Time horizon.
- Position sizing rationale.
- Exit or invalidation conditions.
- Human review or permission state.

## Product Principle

Kairos should compound the human's judgment into infrastructure.

The system should make it easier to:

- Encode intuition as laws.
- Route new information to the right branches.
- Remember prior context and corrections.
- Escalate only meaningful events.
- Watch agents reason.
- Compare bull and bear cases.
- Learn from outcomes.
- Improve the inference architecture over time.

The product succeeds when the human can understand why the system believed something, why it escalated, why it ignored something, and how to make it better.
