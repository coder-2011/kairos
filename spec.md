# Kairos Spec

## 1. Vision

Kairos is a hierarchical, event-driven trading-agent architecture built around human-authored market "laws."

A law is a narrow, explicit thesis about what kind of information matters. Each law gets its own monitoring branch. A cheap heartbeat agent watches that branch frequently, identifies potentially high-entropy events, and escalates only when deeper reasoning is warranted. A stronger research/debate system then decides whether the event is actionable, whether a human should be notified, or whether a trade intent should be generated.

The system is meant to be human-built, human-maintained, and human-steerable. The human does not merely configure the system once. The human continuously creates laws, injects intuition, routes sources, participates in debates, adjusts weights, and improves the architecture as the system is used.

## 2. Core Goal

Replace repetitive manual market checking with a platform where the user's time compounds into better infrastructure:

- Instead of repeatedly checking whether known catalysts happened, the user encodes those checks as laws.
- Instead of manually triaging every link or source, the user sends information to a router.
- Instead of trusting one monolithic model, the system uses branch-specific monitoring plus deeper multi-agent debate.
- Instead of hiding reasoning, the system exposes evidence, disagreement, human input, and decision trails.

## 3. Non-Goals

- Kairos is not intended to be an uninspectable autonomous trading bot.
- Kairos should not default to live trade execution.
- Kairos should not rely on one hardcoded market strategy.
- Kairos should not assume one database, deployment target, job runner, or UI framework before those decisions are made.

## 3.1 Current Technical Decisions

Current stack decisions:

- Model calls: OpenRouter is the gateway for all model calls.
- Agent implementation framework: LangChain.
- Agent and workflow orchestration: LangGraph for every agent workflow, not only debates.
- Online research/search: Exa API.
- Persistent agent memory: Supermemory, available to all agents.
- Brokerage: Alpaca is the planned brokerage integration.
- Live ticker snapshots and heartbeat market-data seeds: Alpaca.
- Finnhub: company news, optional market/research endpoints, and broader information-agent tooling where useful.
- Primary language: TypeScript for most implementation work.
- Database: no database initially. Use local files for audit/replay only and
  Supermemory for agent-usable memory and retrieval. Do not add local embedding
  or vector indexes unless this decision changes explicitly.
- Frontend: React with Vite.
- Styling/UI: Tailwind CSS and shadcn/ui.
- Mobile shell: Capacitor for iOS/Android wrapping the same web app.

Implications:

- Model interfaces should be built around OpenRouter first.
- Model-backed agents should use LangChain-compatible model, prompt, tool, and structured-output abstractions.
- Heartbeat agents, router agents, gate agents, big research agents, debate agents, synthesis agents, and memory/retrieval agents should all be implemented as LangGraph nodes or graphs.
- Multi-agent debate and agent workflows should use LangGraph.
- LangGraph workflows should use explicit state, nodes, conditional edges, checkpoints, and streamed updates so agent behavior is inspectable and replayable.
- Use LangSmith as the default LangGraph tracing and observability backend when credentials are available, while preserving local product event logs for audit and UI replay.
- Online source discovery and research search should use Exa API.
- Persistent cross-agent memory should use Supermemory.
- Model selection should still be configurable by role, for example heartbeat model, big research model, debate participant model, and synthesis model.
- Trading execution interfaces should keep Alpaca isolated behind a broker adapter.
- Ticker snapshot access should use Alpaca behind a provider adapter.
- Finnhub access should stay isolated behind a data-provider adapter for news and optional research endpoints.
- Persistence should start with local audit/replay files plus Supermemory as the
  persistent agent memory and retrieval backbone. Add a database or local vector
  index only if the architecture decision changes explicitly.
- The frontend should be implemented as a React/Vite app, styled with Tailwind and shadcn/ui, with Capacitor used when native mobile shells are needed.

## 4. First-Class Concept: Laws

Laws are the foundation of the system.

A law defines:

- What market-relevant phenomenon the branch watches.
- Why the phenomenon could matter.
- What counts as high-information or high-entropy evidence.
- What sources are relevant.
- What should be ignored as noise.
- What escalation threshold should be used.
- Which assets, companies, sectors, or instruments the law applies to.
- Whether the branch can only notify, can produce paper trades, or can propose live trade intents.

Example law:

```md
Name: Palantir new enterprise or government deals
Asset scope: PLTR
Watch for: credible reports that Palantir signed a new deal, expanded an existing deal, or entered a strategically important customer relationship.
High-entropy signal: a new customer, unusually large contract value, new sector expansion, government adoption, multi-year contract language, or evidence the market has not priced it in.
Ignore: generic commentary, reposts of old deals, low-quality rumor accounts, small reseller announcements with no materiality.
Escalate when: the heartbeat agent finds a credible new source suggesting a materially relevant deal.
```

## 5. Branch Architecture

Each law creates a branch.

A branch owns:

- One heartbeat agent configuration.
- Law instructions and law version history.
- Watched assets and entities.
- Source preferences and source exclusions.
- Recent observations.
- Trigger history.
- Escalation thresholds.
- Branch memory.
- Evaluation records.

Branches should be independently:

- Created.
- Edited.
- Forked.
- Enabled or disabled.
- Backtested or replayed.
- Evaluated for false positives and missed events.

## 6. Heartbeat Agent

The heartbeat agent is the cheap frequent monitor.

The heartbeat agent should be implemented as a LangGraph workflow using LangChain-compatible model calls, tools, and structured outputs.

Expected model class:

- Small model.
- Cheap enough to run often.
- Example target: Qwen 3.5 9B or similar.
- Default cadence: every 5 minutes, configurable per branch.

Responsibilities:

- Read the law.
- Check relevant new data.
- Compare new observations against recent branch memory.
- Decide whether anything meaningfully new, surprising, or high-entropy happened.
- Produce a compact trigger packet when escalation is warranted.

The heartbeat agent should not:

- Perform full trade reasoning.
- Execute trades.
- Spend large inference budgets by default.
- Escalate routine noise.

Heartbeat output should include:

- Law ID and branch ID.
- Timestamp.
- Sources checked.
- New evidence found.
- Why the evidence may be high entropy.
- Confidence.
- Suggested escalation type.
- Compact summary for the big agent.

## 6.1 Multi-Gate Small-to-Big Escalation

The transition from small heartbeat agents to expensive big-agent research should be multi-gate.

Each gate should be represented as a LangGraph node or subgraph with explicit input/output schemas.

The heartbeat agent should not directly trigger the most expensive workflow every time it sees something interesting. Instead, escalation should pass through one or more lightweight gates that filter noise, check novelty, and decide how much inference budget the event deserves.

Possible gates:

- `Novelty gate`: checks whether the event is actually new relative to recent branch memory and Supermemory-retrieved context.
- `Source credibility gate`: checks whether the source is credible enough to justify more work.
- `Law relevance gate`: checks whether the event truly matches the law rather than adjacent noise.
- `Materiality precheck gate`: estimates whether the event could plausibly matter for the tracked asset.
- `Duplicate suppression gate`: blocks reposts, repeated articles, and stale information.
- `Budget gate`: decides whether to ignore, summarize, notify lightly, run medium research, or invoke the full big-agent debate.

Multi-gate outputs can include:

- Ignore.
- Store only.
- Add to branch memory.
- Ask heartbeat to monitor.
- Notify human lightly.
- Run medium research.
- Escalate to big-agent research.
- Escalate to full LangGraph debate.

Each gate should preserve its rationale so the system can later inspect why an event did or did not reach the big-agent layer.

## 7. Big Agent

The big agent is the expensive reasoning layer.

The big agent should be implemented as a LangGraph research workflow using LangChain-compatible tool calls and structured outputs.

Responsibilities:

- Investigate escalated events.
- Query deeper source data.
- Query market and historical data.
- Evaluate materiality.
- Estimate whether the event is likely to move the relevant asset.
- Decide whether to notify the human, start a debate, produce a paper trade, or produce a live trade intent if live trading is explicitly enabled.

The big agent should reason about:

- Source credibility.
- Novelty.
- Market awareness.
- Contract size or catalyst magnitude.
- Time horizon.
- Comparable historical events.
- Current price action.
- Liquidity and volatility.
- Risk and invalidating evidence.
- Whether the event is already priced in.

## 8. Multi-Agent Debate

The deeper reasoning layer should support multi-agent debate, not merely multi-model voting.

The first debate framework should use LangGraph with LangChain-compatible agent/tool nodes:

- `judge`: the overseer that selects the next speaker, emits the current plan, decides when to stop, and produces the final synthesis.
- `bull`: argues why the event may support owning, adding, buying, or continuing to hold exposure.
- `bear`: argues why the event may support avoiding, reducing, or selling exposure, or why it may be noise, already priced in, immaterial, risky, or negative.
- `human`: optional contextual input only. The debate should treat human input as useful but unverified context, not as a command or decision.

The debate should start from a smaller model calling the debate loop with:

- A compact summary of what has been discussed or found so far.
- Seeded basic financials.

Bull and bear messages should expose:

- Agent name.
- Message type.
- Argument.
- Confidence.

The debate-facing tools should be:

- `exa_search`: normal Exa search.
- `exa_research`: Exa deep/research mode.
- `information`: general retrieval interface for source reading, company news, SEC filings, recent-news lookup, and other API-backed information.

The final judge decision should include:

- Summary.
- Guarded action: buy, sell, watch, research, or no action.
- Confidence.
- Citations.

The debate should receive current portfolio context when available: cash,
buying power, portfolio value, relevant positions, quantities, market value,
and unrealized P/L. The portfolio context informs buy/sell reasoning, but it
does not authorize execution.

The debate system should preserve:

- Full transcript.
- Agent identities.
- Tool calls and tool results.
- Disagreement points.
- Final synthesis.
- Citations.

## 9. Human Intuition Injection

Human participation is a core feature.

The human should be able to:

- Create laws.
- Edit laws.
- Route links and notes to the system.
- Join a debate as a participant.
- Set the weight of their own opinion.
- Override or veto system decisions.
- Mark model reasoning as wrong, useful, stale, or incomplete.
- Add qualitative intuition that models may not infer from raw data.

In the first multi-agent debate loop, human interjections are context only. They should be passed to agents as unverified context and should not directly approve, veto, pause, stop, trade, notify, or change thresholds. Separate explicit product controls can be designed later for override, veto, approval, and other human actions.

Human input should be:

- Explicitly attributed.
- Weighted according to configuration.
- Stored in the decision trail.
- Distinguishable from model-generated reasoning.

## 10. Router Agent

The router agent handles human-supplied information.

The router agent should be implemented as a LangGraph workflow with structured extraction, law matching, and routing nodes.

Inputs can include:

- Links.
- Text notes.
- Screenshots.
- Documents.
- Source descriptions.
- Claims from conversations.
- Market observations.

Responsibilities:

- Extract entities, assets, source type, and possible relevance.
- Match information to one or more laws.
- Send the information to relevant heartbeat agents or branches.
- Ask for a new law when the information is useful but no existing law fits.
- Track source provenance.

Router output should include:

- Input ID.
- Extracted entities.
- Matched laws and branches.
- Relevance score.
- Routing rationale.
- Whether a new law is recommended.

## 11. Data and Memory

The system should support multiple data classes:

- Law definitions.
- Branch state.
- Source events.
- Market data.
- Historical catalyst data.
- Model outputs.
- Debate transcripts.
- Human annotations.
- Trade intents.
- Notifications.
- Execution records if trading is enabled.

The architecture should assume that big agents need access to:

- Historical market data.
- Company/entity data.
- News and filings.
- Prior branch observations.
- Prior debates and outcomes.
- User-provided sources.

Data access should be queryable, auditable, and provider-agnostic.

### 11.0 Persistent Agent Memory

Supermemory is the shared persistent memory layer for agents.

All agents should be able to access relevant persistent memory, including:

- Prior law behavior.
- Prior branch observations.
- Human preferences and annotations.
- Debate lessons.
- Known source reliability notes.
- Repeated failure modes.
- Useful historical context.

Supermemory is the primary memory and retrieval backbone for agent-usable
information. Every meaningful piece of user input, source text, agent output,
tool result summary, run event, debate transcript, trade intent, notification,
and correction should be written through Supermemory when credentials are
present.

Local files remain the audit and replay log. They should not be treated as a
separate semantic retrieval layer. Do not introduce a local embedding model,
local vector index, or parallel RAG store unless this architecture decision
changes explicitly.

### 11.1 Supermemory-First Data Pipeline

The initial data pipeline should stay simple and Supermemory-first.

Kairos should ingest tracked-stock, tracked-sector, source, router, heartbeat,
debate, and trading-safety information into Supermemory as documents,
conversations, and direct memories. The local filesystem stores the canonical
audit trail needed for replay and inspection, but agents should retrieve prior
context through Supermemory profile/search rather than local embeddings.

Target storage model:

- Supermemory global container for cross-branch system memory.
- Supermemory branch containers for law-specific memory and observations.
- Supermemory branch profile containers for user-profile context, one per
  branch, using a deterministic `branch_profile_<branchId>` container tag unless
  explicitly overridden.
- Full records written as Supermemory documents/conversations for source and
  transcript fidelity.
- Compact direct memories written for high-signal summaries and future
  retrieval.
- Local JSON/JSONL files retained for auditability, replay, and UI state.

Expected access pattern:

- Heartbeat agents inspect seeded provider data plus Supermemory profile/search
  for the relevant branch.
- Big agents and debate agents retrieve deeper historical context through
  Supermemory search/profile.
- Agents should be able to query Supermemory by ticker, sector, date range,
  law, source type, and semantic similarity.
- Historical source records can still be kept locally for audit/replay, but
  agent retrieval should go through Supermemory.

This should cover the entire early data pipeline:

1. Pull or receive data from Finnhub, Alpaca, and human-routed sources.
2. Normalize the data into compact, citeable records.
3. Write full records to Supermemory documents or conversations.
4. Write high-signal summaries to Supermemory direct memories.
5. Keep local JSON/JSONL copies only for audit, replay, and UI state.
6. Retrieve relevant context through Supermemory for heartbeat checks,
   big-agent research, and multi-agent debate.

This keeps the system easy to inspect, replay, back up, and modify while
avoiding a separate embedding pipeline. A database can be reconsidered later if
local audit files become too slow, too large, or too hard to query safely.

### 11.2 Future: Continuously Updated Data Packets

Down the line, Kairos should maintain continuously updated data packets for models.

A data packet is a compact but deep context artifact that summarizes the information an agent needs without forcing it to repeatedly scan the full corpus. These packets should be updated as new source records, market events, law outcomes, human annotations, and debate conclusions arrive.

Possible packet types:

- `Ticker packet`: deep current summary for a tracked stock.
- `Sector packet`: deep current summary for a tracked sector.
- `Law packet`: current state of a law, including what it watches, recent triggers, known failure modes, and relevant context.
- `Branch packet`: operational summary for a branch, including recent heartbeat outcomes and escalation history.
- `Source reliability packet`: notes on which sources tend to be useful, noisy, stale, promotional, or market-moving.
- `Catalyst packet`: summary of a specific catalyst or event cluster.

Packets should contain:

- Current thesis.
- Important recent changes.
- Relevant historical context.
- Known open questions.
- Contradictory evidence.
- Human annotations.
- Agent debate conclusions.
- Source citations or source IDs.
- Last updated timestamp.

These packets should be optimized for agent use: dense, citeable, structured,
and easy to retrieve from Supermemory.

## 12. Trading Decision Flow

Default flow:

1. Law exists.
2. Heartbeat agent runs on schedule.
3. Heartbeat detects possible high-entropy evidence.
4. Heartbeat emits trigger packet.
5. Big agent performs research.
6. Debate starts if the event may be actionable or ambiguous.
7. Human may join or be notified.
8. System produces one of:
   - Ignore.
   - Watch.
   - Notify human.
   - Create research task.
   - Produce paper trade.
   - Produce live trade intent if explicitly enabled.

Trade intent should include:

- Asset.
- Direction.
- Current holding or cash context used for the decision.
- Position sizing rationale.
- Time horizon.
- Catalyst.
- Evidence.
- Expected move.
- Risk.
- Stop or invalidation condition.
- Exit condition.
- Whether this is paper or live.
- Required approvals.

## 13. Safety and Permissioning

Live trading must be treated as a high-risk boundary.

Defaults:

- Research only.
- Notifications allowed.
- Paper trading allowed when configured.
- Live trading disabled unless explicitly configured.

Any live execution path should require:

- Broker configuration.
- Explicit user opt-in.
- Order size limits.
- Per-law permission settings.
- Audit logging.
- Kill switch.
- Dry-run mode.
- Clear distinction between recommendation, trade intent, and executed order.

## 14. Customizability and Forkability

Kairos is expected to be forked and personalized.

Users should be able to add:

- New laws.
- New branch templates.
- New data connectors.
- New debate agents.
- New execution policies.
- New notification channels.
- New evaluation methods.
- New model providers.

Architecture should prefer:

- Plain files or explicit schemas for configuration where practical.
- Provider-agnostic interfaces.
- Small modules.
- Clear extension points.
- Reproducible decision logs.

## 15. Inference Architecture Evolution

The system should allow new inference structures over time.

Examples:

- Different heartbeat cadences per law.
- Confidence-calibrated escalation thresholds.
- Law-specific source ranking.
- Multi-stage escalation.
- Debate only above materiality thresholds.
- Human-in-the-loop approval queues.
- Agent tournaments based on historical performance.
- Automatic law quality scoring.
- Backtesting laws against historical catalysts.
- Auto-research loops that study a specific inference or trading system, identify weaknesses, propose improvements, evaluate them, and update the system only after human review.

### 15.1 Future: Auto-Research Loop for Inference Systems

Down the line, Kairos should support an auto research-style loop whose job is to improve a specific inference system over time.

This loop would treat an inference trading system as an object of research. It would inspect performance, find failure modes, generate hypotheses, test possible improvements, and recommend changes to the human.

Possible responsibilities:

- Analyze false positives, missed catalysts, weak debates, bad escalations, and poor trade intents.
- Compare different heartbeat prompts, law formats, source-ranking methods, debate structures, and materiality thresholds.
- Run offline evaluations and historical replays.
- Propose new branch templates or law improvements.
- Identify when an inference structure is overfitting, too noisy, too expensive, or missing important data.
- Maintain research notes explaining what was tried and what changed.

This should remain a future capability. The initial system should first make laws, branches, routing, escalation, audit logs, and human review work reliably.

## 16. Observability

Every meaningful system decision should be inspectable.

Useful views:

- Active laws.
- Branch status.
- Last heartbeat per branch.
- Recent triggers.
- Escalations in progress.
- Debate transcripts.
- Human interventions.
- Trade intents.
- Notifications.
- False positives and missed opportunities.

Each event should preserve:

- Timestamp.
- Source.
- Actor.
- Inputs.
- Output.
- Confidence.
- Rationale.

## 17. Initial Build Priorities

The first useful version should focus on the core loop:

1. Define law schema.
2. Define branch schema.
3. Create heartbeat runner abstraction.
4. Create trigger packet format.
5. Create router input format.
6. Create big-agent research interface.
7. Store event logs and decision trails.
8. Build a simple way for the human to create laws and inspect escalations.
9. Keep trade execution as paper-only or recommendation-only until the rest is reliable.

## 18. Open Questions

- Which TypeScript runtime and framework should be used?
- Which LangChain JS packages and LangGraph JS APIs should be used for the first implementation?
- Which OpenRouter models should run heartbeat agents?
- Which OpenRouter models should run big agents?
- Should laws be stored as markdown, JSON/YAML, database records, or both?
- What exact dashboard/debate UI flows should be built first?
- What is the minimum viable audit log?
- How should law performance be evaluated?
- How should the human's debate weight interact with model confidence?

## 19. Working Assumptions

- The system starts with research, routing, debate, and notification before live trading.
- Laws are user-authored and should be easy to edit.
- A small heartbeat model can run frequently enough to make broad monitoring affordable.
- Expensive reasoning should happen only after a branch finds potentially meaningful evidence.
- Human intuition is not an exception path; it is part of the core architecture.
