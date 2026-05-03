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

## Stack Decisions
- Model gateway: OpenRouter for all model calls.
- Agent implementation framework: LangChain.
- Agent/workflow orchestration: LangGraph for every agent workflow, not only debates.
- Online research/search: Exa API.
- Persistent agent memory: Supermemory, available to all agents.
- Brokerage: Alpaca is the planned brokerage integration.
- Market data: Finnhub is the planned trading/market data provider.
- Live ticker data: Alpaca may be used where it fits better than Finnhub.
- Primary implementation language: TypeScript.
- Runtime/package manager: Bun.
- Frontend: React with Vite.
- Styling/UI: Tailwind CSS and shadcn/ui.
- Mobile shell: Capacitor for iOS/Android wrapping the web app.
- Database: none planned initially. Prefer local files, yearly corpora, rolling recent-data snapshots, and local embedding/vector indexes.

## Core Product Concepts
- `Law`: a human-authored rule or thesis defining one narrow market-relevant thing to watch.
- `Branch`: one law-bound monitoring lane with its own heartbeat model, state, memory, thresholds, and escalation policy.
- `Heartbeat agent`: a small, cheap model that runs frequently, usually every 5 minutes, and checks whether its law has encountered high-information or high-entropy evidence.
- `Escalation`: the multi-gate transition from heartbeat monitoring to a larger research/debate workflow.
- `Big agent`: a stronger agent that performs deeper research, queries market/context data, reasons about materiality, and decides whether to notify, debate, or trade.
- `Router agent`: an ingestion agent that accepts human-supplied links, notes, documents, or source descriptions and routes them to relevant branches.
- `Human participant`: in the first debate loop, the user can add contextual input that agents consider as useful but unverified context, not as a direct command or decision.

## Architecture Principles
- Keep laws first-class and portable. A law should be data/config plus versioned instructions, not hardcoded behavior.
- Design for many branches. Each branch should be independently inspectable, configurable, enabled, disabled, and evaluated.
- Prefer event-driven escalation over constant expensive reasoning.
- Small-to-big escalation should be multi-gate: use lightweight checks between heartbeat detection and expensive big-agent research.
- Preserve evidence trails. Every escalation should cite triggering evidence, source metadata, timestamps, model outputs, confidence, and decision rationale.
- Separate monitoring, research, debate, execution, and notification responsibilities.
- Make human override and human review natural parts of the system.
- Treat trading execution as a high-risk boundary requiring explicit safeguards, audit logs, and configurable permissions.
- Keep the initial data pipeline simple: store tracked-stock and tracked-sector corpora locally, build embeddings over yearly data, and maintain rolling recent windows for heartbeat and debate agents.
- Down the line, support continuously updated data packets: deep, compact, citeable summaries for tickers, sectors, laws, branches, sources, and catalysts.

## Agent Behavior Rules for This Repo
- Before implementing non-trivial behavior, read `spec.md`.
- Treat OpenRouter, LangChain, LangGraph, Exa, Supermemory, Alpaca, Finnhub, and TypeScript as current stack decisions unless the user changes them.
- Do not assume a database, job runner, queue, or deployment target are finalized unless existing code or docs say so.
- Default persistence should be local-file based unless the user explicitly asks for a database.
- Implement model-backed agents with LangChain-compatible model, prompt, tool, and structured-output abstractions.
- Represent heartbeat agents, router agents, gate agents, big research agents, debate agents, synthesis agents, and memory/retrieval agents as LangGraph nodes or graphs.
- Use explicit LangGraph state, nodes, conditional edges, checkpoints, and streamed updates for inspectable agent workflows.
- Use LangSmith tracing for LangGraph observability when credentials are present, but keep local product event logs as the audit and UI replay source.
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

## Current Folder Layout
- `prd/`: product requirement docs and behavior specs for agent components before full implementation.
- `src/agents/heartbeat/`: the small-model heartbeat agent implemented as a constrained LangGraph/LangChain workflow.
- `src/agents/heartbeat/types.ts`: branch config, seed bundle, heartbeat output, provider, and escalation event types.
- `src/agents/heartbeat/schema.ts`: Zod schemas for model output and runtime validation.
- `src/agents/heartbeat/seed.ts`: deterministic seed bundle construction.
- `src/agents/heartbeat/agent.ts`: LangGraph heartbeat workflow and LangChain structured output call.
- `src/agents/heartbeat/escalation.ts`: helper that creates a pending big-model escalation event when the heartbeat output says to escalate.

## Heartbeat Agent Configuration
- The heartbeat agent output is intentionally small: `branch_id`, `timestamp`, `decision`, and `summary`.
- The default seed bundle is fixed initially: current price, recent volume, recent ticker movement, Supermemory context, and news headlines/summaries for the configured seed window.
- The default seed window is `30` days unless branch configuration overrides it.
- Optional seeded data sources should be represented as generic keyed toggles in `BranchConfig.seededData.optionalSources`.
- Do not hardcode a large optional source list in the core branch config; the UI can own that source catalog later.
- Supermemory should be scoped with `BranchConfig.memory.supermemoryContainerTag` when provided; otherwise derive a `branch_...` container tag from the branch ID.
- If the heartbeat output decision is `escalate`, preserve the full seed bundle with the escalation event for the big model.

## Top-Level Directory Map
- `apps/`: runnable applications and user-facing entrypoints, such as the CLI, local API server, web dashboard, and future mobile shell integration.
- `packages/`: reusable TypeScript packages that contain Kairos domain logic, schemas, local storage, provider adapters, heartbeat logic, debate workflows, router logic, and trading-intent boundaries.
- `services/`: separately runnable supporting services when a workflow needs its own process boundary, runtime, worker, or long-lived integration that should not live inside an app.
- `data/`: local-file persistence for laws, branches, corpora, recent windows, event logs, debate records, artifacts, and audit trails. Do not store secrets here.
- `documentation/`: focused implementation and integration documentation that expands on `spec.md` only when useful.
- `prd/`: product requirement documents for specific implementation slices and feature phases.

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
- Use Bun for installs, scripts, local CLIs, tests, and development commands.
- Prefer `bun install`, `bun run <script>`, and `bunx <tool>` over npm, npx, pnpm, or yarn equivalents.
- When setup commands are added, keep `README.md`, `justfile`, and this section aligned.

## Build, Test, and Development Commands
- Use Bun commands by default.
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
