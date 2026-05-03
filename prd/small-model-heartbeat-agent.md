# Small Model Heartbeat Agent PRD

## 1. Purpose

The small model heartbeat agent is the cheap, frequent monitoring layer in Kairos.

It should be implemented as a LangGraph workflow using LangChain-compatible model calls, tool calls, and structured outputs. Even though this is a small model workflow, it should follow the same LangChain + LangGraph agent standard as the rest of the system.

Its job is not to make trading decisions. Its job is to answer one narrow question:

> Has anything potentially useful, relevant, surprising, or high-information happened for this branch's law that deserves escalation to the big model?

The heartbeat agent should be optimized for broad, cheap awareness. It should scan a large amount of recent context, use a small set of inexpensive tools, compare new information against the branch's law and memory, and produce a compact escalation packet only when something may matter.

## 2. Non-Goals

The heartbeat agent should not:

- Decide whether to buy, sell, short, hedge, or size a position.
- Execute trades.
- Produce final investment recommendations.
- Perform deep research that belongs to the big model.
- Debate bull and bear cases in depth.
- Spend expensive inference or tool budgets by default.
- Escalate routine noise, duplicate headlines, or already-known events unless they materially change the information state.

## 3. Model Class

The intended model class is a small, cheap model, initially assumed to be around the 9B parameter range.

Expected characteristics:

- Cheap enough to run frequently.
- Capable of reading large seeded context windows.
- Good enough at relevance filtering, novelty detection, and summarization.
- Not trusted for final financial reasoning.

The system should assume this model is fallible. Its outputs should be inspectable, replayable, and easy for the big model or human to audit.

## 4. Core Responsibility

For each heartbeat run, the model should:

1. Read the active law and branch configuration.
2. Read seeded recent information for configured assets.
3. Inspect recent ticker movement and market data.
4. Use cheap search tools when seeded information is insufficient.
5. Compare new evidence against recent memory and Supermemory.
7. Decide whether the evidence is potentially useful enough to escalate.
8. Emit either a no-escalation record or a compact trigger packet.

The key output is not certainty. The key output is calibrated triage.

## 5. Default Seeded Inputs

Each heartbeat run should receive a large seeded input bundle before tool use.

Default seeded window:

- `n_days`: configurable.
- Initial default: `30`.

Seeded input is not finalized yet. The product should support configuring it through the UI, but the initial version should assume a broad bundle of compact market and company context for each configured stock, asset, company, sector, or instrument.

Default seeded inputs:

- Recent headlines.
- Short summaries of recent articles or news items.
- Current price.
- Recent volume.
- Recent ticker movement.
- Supermemory context.

Because the model is cheap, the system should prefer giving it a large amount of compact, structured context rather than forcing it to perform many tool calls.

All other seeded inputs should be configurable by the user.

Configurable seeded inputs may include:

- Recent branch memory.
- Source names.
- Publication timestamps.
- Mentioned entities.
- Ticker symbols.
- Known relevance tags.
- Recent volatility context.
- Earnings context.
- Insider buying and selling.
- SEC filings and filing summaries.
- Company press releases.
- Analyst rating changes.
- Options activity.
- Short interest.
- Institutional ownership changes.
- Sector and peer movement.
- Macro or commodity context relevant to the branch.
- Social or retail attention metrics.
- Custom user-provided feeds.

## 6. Tools

The heartbeat agent should have access only to cheap, bounded tools.

### 6.1 Search API

The heartbeat agent should have access to a decent search API through Exa search.

Allowed uses:

- Verify whether a seeded headline reflects a new event or stale repost.
- Find one or two corroborating sources.
- Search for recent coverage of a specific company, asset, law topic, or entity.
- Look up whether an event is already broadly covered.

The heartbeat agent should not use search for open-ended deep research. If broad research is needed, it should escalate.

### 6.2 Recent Ticker Movement and Market Data

The heartbeat agent should have access to recent ticker movement and recent market data.

Useful fields include:

- Price movement over configurable windows.
- Intraday and multi-day returns.
- Volume and relative volume.
- Volatility.
- Gap up or gap down behavior.
- Significant moves around news timestamps.
- Basic sector or index comparison where available.

The heartbeat agent should use this data to detect whether an event may already be moving the market, not to make a trade decision.

### 6.3 Earnings and Company Event Context

The heartbeat agent should initially have access to earnings-related context when available.

Useful fields include:

- Days until next earnings.
- Most recent earnings date.
- Recent earnings summary.
- Revenue, EPS, guidance, or margin surprise summaries.
- Management commentary summaries.
- Whether recent news appears related to an upcoming or recent earnings event.

The heartbeat agent should use earnings context to understand timing and potential catalyst relevance, not to make a trade decision.

### 6.4 Future Configurable Data Sources

The UI should eventually allow each branch to configure which additional data sources are seeded into the heartbeat prompt.

Potential configurable sources include:

- SEC filings and filing summaries.
- Insider transactions.
- Analyst updates.
- Options flow.
- Short interest.
- Institutional ownership.
- Press releases.
- Earnings calendars.
- Sector and peer comparison data.
- Custom user data feeds.

These are not initial requirements. They should be treated as branch-level configuration once data access patterns are defined.

### 6.5 Supermemory

The heartbeat agent should be seeded with Supermemory context and may also have access to lightweight Supermemory retrieval.

Allowed uses:

- Retrieve prior related observations.
- Check whether an event is new or already known.
- Retrieve human notes relevant to the law.
- Retrieve prior false-positive patterns.
- Retrieve branch-specific preferences and corrections.

Supermemory should be treated as context, not authority. If memory conflicts with recent evidence, the heartbeat agent may still escalate and let the big model resolve the conflict.

## 7. Law Context

Every heartbeat run must include the active law.

The law should define:

- What phenomenon the branch watches.
- Why it could matter.
- What counts as high-information evidence.
- What sources matter.
- What should be ignored.
- Relevant tickers, assets, companies, sectors, or instruments.
- Escalation threshold.
- Whether the branch can notify, propose paper trades, or propose live trade intents.

The heartbeat agent must judge relevance relative to the law, not relative to general market interest.

## 8. Escalation Criteria

The heartbeat agent should escalate when evidence appears potentially:

- New.
- Relevant to the law.
- Material to an asset, company, sector, or catalyst thesis.
- Underappreciated or not obviously priced in.
- High-entropy relative to the branch's recent memory.
- Supported by credible sources or official disclosures.
- Connected to unusual ticker movement, volume, or volatility.

The heartbeat agent may escalate even with incomplete evidence if the event looks time-sensitive or potentially material.

The heartbeat agent should avoid escalation when evidence is:

- Duplicate.
- Stale.
- Generic commentary.
- Low-quality rumor without corroboration.
- Unrelated to the active law.
- Already escalated recently with no meaningful update.
- Obvious market-wide noise that does not affect the branch thesis.

## 9. Output Contract

Each heartbeat run should produce a durable output record.

### 9.1 No-Escalation Output

When nothing appears worth escalating:

```json
{
  "branch_id": "branch_id",
  "timestamp": "iso_timestamp",
  "decision": "no_escalation",
  "summary": "No new high-information evidence found."
}
```

### 9.2 Escalation Trigger Packet

When something may matter:

```json
{
  "branch_id": "branch_id",
  "timestamp": "iso_timestamp",
  "decision": "escalate",
  "summary": "Compact description of what may be happening."
}
```

## 10. Prompt Requirements

The heartbeat system prompt should emphasize:

- You are a triage model, not a trader.
- Your only job is to detect potentially useful events.
- Escalate when something may be materially relevant, novel, or high-entropy.
- Do not escalate routine noise.
- Keep the output compact.
- Use tools only when they materially improve the decision.
- Treat seeded memory and Supermemory as helpful but fallible.
- If uncertain but the event may be time-sensitive or material, escalate with uncertainty clearly stated.
- Never claim final trading action is warranted.

## 11. Configurable Parameters

Initial configurable parameters:

- `seed_window_days`, default `30`.
- `heartbeat_interval_minutes`, default `5`.
- `max_search_calls_per_run`.
- `max_memory_queries_per_run`.
- `duplicate_suppression_window_hours`.
- `assets`.
- `branch_id`.
- `enabled`.
- Optional seeded data source toggles, represented generically as keyed UI-configurable source names.

These should be branch-level settings where practical.

The default seeded data bundle is fixed initially:

- Current price.
- Recent volume.
- Recent ticker movement.
- Supermemory context.
- News headlines and summaries for `seed_window_days`, default `30`.

All other seeded data should be treated as optional branch configuration.

## 12. Observability and Evaluation

Every heartbeat run should be auditable.

The system should record:

- Seeded input bundle metadata.
- Tool calls made.
- Decision.
- Summary.
- Whether an escalation was later judged useful.
- Whether a missed event was later discovered.

Useful evaluation labels:

- True useful escalation.
- False positive escalation.
- Duplicate escalation.
- Missed event.
- Too early but reasonable.
- Too late.
- Correct no-escalation.

The goal is to tune laws, thresholds, memory retrieval, and prompt behavior over time.

## 13. Relationship to Big Model

The heartbeat agent calls the big model only by emitting an escalation trigger packet.

The big model owns:

- Deep research.
- Source credibility analysis.
- Market impact reasoning.
- Debate.
- Notification decisions.
- Trade intent generation.
- Risk analysis.
- Human-facing synthesis.

The heartbeat agent should pass enough context for the big model to begin efficiently, but not try to solve the whole problem.

## 14. Open Questions

- Which Exa search endpoint and result shape should be standardized?
- What provider should supply SEC filing summaries?
- How much raw article text should be included in the seeded input versus summarized input?
- What Supermemory namespace structure should be used for laws, branches, human notes, and prior observations?
- Should duplicate suppression be deterministic, model-based, or both?
- What confidence threshold should trigger escalation for time-sensitive events?
- Should heartbeat output be strictly JSON, JSON with markdown notes, or typed TypeScript objects serialized to JSON?
