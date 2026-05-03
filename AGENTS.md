# Repository Guidelines

Naman owns this repository.
Editor: `code <path>`.

## Project Objective
Build Kairos: a hierarchical, event-driven trading-agent platform where human-authored "laws" define what each small heartbeat agent watches, when it escalates, and how larger research/debate agents decide whether to notify the human or execute a trade.

The product is intentionally human-maintained. The goal is not a fully autonomous black box. The system should make it easier for a human to encode intuition, route information, observe agent reasoning, participate in debates, and continuously improve the inference architecture over time.

## Source of Truth
- `spec.md` is the primary product and architecture specification.
- Keep this file aligned with `spec.md` when project direction changes.
- If implementation details conflict with `spec.md`, surface the conflict before making broad changes.

## Core Product Concepts
- `Law`: a human-authored rule or thesis defining one narrow market-relevant thing to watch.
- `Branch`: one law-bound monitoring lane with its own heartbeat model, state, memory, thresholds, and escalation policy.
- `Heartbeat agent`: a small, cheap model that runs frequently, usually every 5 minutes, and checks whether its law has encountered high-information or high-entropy evidence.
- `Escalation`: the transition from heartbeat monitoring to a larger research/debate workflow.
- `Big agent`: a stronger agent that performs deeper research, queries market/context data, reasons about materiality, and decides whether to notify, debate, or trade.
- `Router agent`: an ingestion agent that accepts human-supplied links, notes, documents, or source descriptions and routes them to relevant branches.
- `Human participant`: the user can join debates as a weighted participant whose input is explicit, attributable, and configurable.

## Architecture Principles
- Keep laws first-class and portable. A law should be data/config plus versioned instructions, not hardcoded behavior.
- Design for many branches. Each branch should be independently inspectable, configurable, enabled, disabled, and evaluated.
- Prefer event-driven escalation over constant expensive reasoning.
- Preserve evidence trails. Every escalation should cite triggering evidence, source metadata, timestamps, model outputs, confidence, and decision rationale.
- Separate monitoring, research, debate, execution, and notification responsibilities.
- Make human override and human review natural parts of the system.
- Treat trading execution as a high-risk boundary requiring explicit safeguards, audit logs, and configurable permissions.

## Agent Behavior Rules for This Repo
- Before implementing non-trivial behavior, read `spec.md`.
- Do not assume the trading stack, broker integration, data providers, model providers, or database are finalized unless existing code or docs say so.
- Keep interfaces provider-agnostic where practical.
- Prefer explicit schemas for laws, branch state, source events, escalations, debate transcripts, decisions, and trade intents.
- Do not implement live trading, broker orders, or account-affecting actions unless the user explicitly asks in that turn.
- If adding trade execution code, default to paper trading or dry-run mode unless explicitly told otherwise.
- Surface financial, reliability, and safety assumptions directly. Do not bury them in implementation details.

## Documentation Structure
- Keep top-level `spec.md` as the project vision and architecture anchor.
- Add more detailed docs only when useful, for example:
  - `documentation/laws.md`
  - `documentation/branches.md`
  - `documentation/router.md`
  - `documentation/debate.md`
  - `documentation/trading-safety.md`
- Avoid creating documentation hierarchy before it is needed.

## Reasoning and Explanations
- Prioritize clarity and truthfulness.
- Separate facts, assumptions, inferences, and speculation.
- Use evidence -> belief update -> conclusion for market reasoning.
- Prefer tests or evaluations that can disconfirm preferred hypotheses.
- Explain concepts simply, but go deep when the user asks for depth.

## Agent Learning Log
- Use only `.codex/learning.md` for durable project learnings.
- Read it before non-trivial implementation work if it exists.
- Append concise entries for major bug fixes, key decisions, and environment issues when appropriate.
- Do not use `.codex/STATE.md` in this repo.

## Environment Setup
- Runtime and framework are not finalized.
- Do not invent setup commands in this file until they exist in the repo.
- When setup commands are added, keep `README.md`, `justfile`, and this section aligned.

## Build, Test, and Development Commands
- Prefer existing `just` recipes when available.
- Do not add live/external API tests as default validation.
- Treat broker, market-data, browser, and paid-model calls as external-integration behavior requiring explicit user awareness.

## Coding Style and Conventions
- TypeScript-first when TypeScript is present; otherwise follow the chosen stack conventions.
- Keep modules focused and interfaces explicit.
- Prefer schema validation at external boundaries.
- Keep edits surgical; avoid broad refactors without clear need.
- Make behavior observable with structured logs or durable event records where useful.

## Git Safety
- No destructive git operations unless explicitly requested.
- No `git commit --amend` unless explicitly requested.
- Do not use `git add .`; use explicit paths or `git add -A` only when scope is intentional.
- Do not commit or push unless the user explicitly asks.

## Trading and Financial Safety
- This repository may contain systems that reason about securities, market data, and trade execution.
- Default to research, simulation, notification, and paper trading.
- Require explicit configuration before any live order path can be enabled.
- Every trade intent should include: law/branch origin, evidence, reasoning, expected catalyst, confidence, risk, time horizon, position sizing rationale, and exit/invalidating conditions.
- Keep auditability higher priority than convenience.

## Browser Automation Safety
- Default safety: do not run `browser-use -b real --profile ...` against local Chrome profiles.
- Local Chrome automation is allowed only when the user explicitly requests local profile usage in that same turn.
- If there is no explicit local-profile request, use non-disruptive alternatives:
  - `browser-use -b remote`
  - isolated copied profiles
  - user-run manual commands
- Never kill normal user Chrome processes.

## TODO.md Policy
- Do not read, write, or modify `TODO.md` unless the user explicitly asks for a `TODO.md` update.
- If used, keep items as markdown checkboxes and make each item concrete and outcome-oriented.

## Engineering Quality Bar
- Make intentional changes with clear value relative to risk.
- Treat agent outputs as fallible and design for inspection, correction, and replay.
- Favor simple, evolvable architecture over premature orchestration complexity.
