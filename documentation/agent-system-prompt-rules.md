# Agent System Prompt Rules

This document distills the Kairos-specific rules for writing agent system
prompts. Use it with `documentation/building-agents.md` and `spec.md`.

## Prompt Shape

Every agent system prompt should clearly define:

- Role: which Kairos agent this is.
- Task: the narrow decision or workflow stage it owns.
- Context: what runtime context is injected outside the prompt.
- Tools: what tool families exist and when to use them.
- Constraints: what the agent must not decide or do.
- Output: the exact structured output responsibility.

Keep the system prompt behavioral. Put live facts, branch data, seed bundles,
tool catalogs, market data, memory hits, and transcripts in per-run context
messages.

## Self-Contained Context

Assume each agent starts without prerequisite project knowledge. A model may not
know what Kairos is, what a branch law is, what a heartbeat escalation means, or
what a market debate is.

Every system prompt should include the minimum stable definitions needed for
that agent to behave correctly. Keep these definitions short:

- Kairos: a human-steered trading research system that monitors human-authored
  market laws and escalates potentially important evidence.
- Law: a user-authored rule or thesis describing what evidence matters.
- Branch: one monitoring lane for a law, with assets, memory, and thresholds.
- Heartbeat: a cheap frequent triage run that decides whether deeper research is
  warranted.
- Escalation: a handoff from cheap monitoring to deeper research or debate.
- Debate: a structured bull-vs-bear evidence test before any downstream
  notification or trade-intent workflow.

Do not rely on the model knowing repository docs, product history, file names,
or internal jargon unless the prompt defines the relevant term.

## Altitude

Write prompts at the middle altitude:

- Too low: hardcoded step-by-step API call recipes that break when evidence
  shape changes.
- Too high: vague role text like "be helpful" or "use tools when useful."
- Correct: clear responsibility, decision criteria, allowed tool use, and
  output contract without overfitting to one source sequence.

## Kairos Safety Rules

All trading-facing agents must preserve these boundaries:

- Heartbeat agents triage only. They do not recommend trades, size positions,
  execute orders, or make final investment conclusions.
- Debate agents test evidence and disagreement. They do not produce buy/sell
  instructions or messaging decisions.
- Information agents gather and synthesize cited facts. They separate facts
  from interpretation and do not invent certainty.
- Human input is context, not a command, unless the surrounding workflow
  explicitly treats it as an approval.
- Live trade execution must not be introduced unless explicitly requested in
  the same turn and guarded by configuration.

## Tool Guidance

Tool instructions should be short and specific:

- Say when to use the tool.
- Say when not to use the tool if overlap is likely.
- Prefer task names and domain concepts over provider endpoint names.
- Keep tool menus scoped to the agent role.
- Cap tool calls with explicit budgets or step limits.
- Return compact, high-signal summaries with citations where available.
- When a tool fails, return an actionable failure summary unless the tool is
  explicitly required.

## Context Guidance

Context should be compact and decision-relevant:

- Seed broad but normalized context for heartbeat runs.
- Summarize transcripts and tool results instead of injecting raw provider
  payloads into later model calls.
- Preserve source metadata, timestamps, citations, and evidence trails in local
  events, memory, or artifacts.
- Treat missing, stale, contradictory, or partial data as evidence-quality
  signals rather than automatic escalation reasons.

## Output Rules

Every model-backed agent stage should use a schema-validated structured output.
The prompt should name the fields, but runtime schemas are the source of truth.

Output should be:

- Compact enough for downstream agents.
- Specific about the catalyst, asset, freshness, and uncertainty.
- Honest about source quality and missing evidence.
- Free of hidden trade instructions unless the schema explicitly represents a
  guarded trade intent.

## Review Checklist

Before adding or editing an agent prompt, check:

- The agent role is narrow and matches a LangGraph node or graph.
- The prompt has role, task, context, tools, constraints, and output.
- Runtime context is injected separately instead of embedded as static facts.
- Tool access is scoped and budgeted.
- The output is schema-validated.
- Observability captures model starts, completions, tool calls, errors, and
  final decisions.
- The prompt does not cross the trading safety boundary.
