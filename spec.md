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
- Kairos should not assume one model provider, broker, data vendor, database, or UI framework before those decisions are made.

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

## 7. Big Agent

The big agent is the expensive reasoning layer.

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

Debate participants can include:

- Bull case agent.
- Bear case agent.
- Skeptic or fraud/noise agent.
- Market microstructure agent.
- Historical analogy agent.
- Risk manager agent.
- Portfolio exposure agent.
- Human participant.

Each participant should produce:

- Position.
- Evidence.
- Confidence.
- Key assumptions.
- What would change its mind.

The debate system should preserve:

- Full transcript.
- Agent identities.
- Evidence references.
- Disagreement points.
- Final synthesis.
- Decision rationale.

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

Human input should be:

- Explicitly attributed.
- Weighted according to configuration.
- Stored in the decision trail.
- Distinguishable from model-generated reasoning.

## 10. Router Agent

The router agent handles human-supplied information.

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

- Which runtime and framework should be used?
- Which model provider should run heartbeat agents?
- Which model provider should run big agents?
- Which market data provider should be used?
- Which broker, if any, should be supported first?
- Should laws be stored as markdown, JSON/YAML, database records, or both?
- What UI should be used for debate participation?
- What is the minimum viable audit log?
- How should law performance be evaluated?
- How should the human's debate weight interact with model confidence?

## 19. Working Assumptions

- The system starts with research, routing, debate, and notification before live trading.
- Laws are user-authored and should be easy to edit.
- A small heartbeat model can run frequently enough to make broad monitoring affordable.
- Expensive reasoning should happen only after a branch finds potentially meaningful evidence.
- Human intuition is not an exception path; it is part of the core architecture.
