# Kairos

Kairos is a hierarchical, event-driven trading-agent platform. A human writes narrow market "laws," each law becomes a branch, cheap heartbeat agents watch those branches, and deeper research/debate workflows only run when new evidence is worth escalation.

The product is deliberately not a black-box trading bot. The architecture is built around inspectable reasoning, explicit evidence trails, human review, paper-trading defaults, and configurable boundaries before any account-affecting action.

## Current status

Kairos is an active prototype with real implementation across the local API, web UI, agent graphs, provider adapters, persistent store, notification layer, and scheduling path. Recent commit history shows work on:

- heartbeat timing controls and scheduled heartbeat drains;
- Supermemory mirroring and prompt-context hardening;
- Deep Research chat/streaming UI and model controls;
- debate handoff, final decisions, and paper-trade intent boundaries;
- Telegram notification coverage;
- Supabase service-role grants and production store hardening;
- UI cleanup for monitoring, portfolio display, nav collapse, and branch deletion edge cases;
- Vercel/Upstash scheduling constraints for five-minute heartbeat drains.

## Core ideas

- `Law`: a human-authored thesis about one kind of market-relevant signal.
- `Branch`: the monitoring lane created from a law, with state, memory, cadence, thresholds, and escalation policy.
- `Heartbeat agent`: a cheap frequent monitor that checks seeded market/news/memory context and decides whether to escalate.
- `Gate`: a lightweight filter for novelty, credibility, law relevance, materiality, duplicate suppression, and budget.
- `Big agent`: an expensive research layer for material escalations.
- `Debate`: a LangGraph workflow with bull, bear, judge, and optional human context.
- `Trade intent`: an auditable proposed action, defaulting to paper-trading boundaries unless live execution is explicitly enabled.

## Stack

- Runtime/package manager: Bun.
- Language: TypeScript.
- Web app: React + Vite.
- Agent orchestration: LangGraph with LangChain-compatible model/tool interfaces.
- Model gateway: OpenRouter.
- Search/research: Exa.
- Agent memory: Supermemory.
- Market/broker adapter: Alpaca.
- News/data adapter: Finnhub.
- Product state: Supabase-backed Kairos store in hosted mode, local files for development fallback.
- Notifications: Telegram.
- Deployment path: Vercel functions plus external scheduling for frequent job drains.

## Repository layout

```text
apps/local-api/          local/server runtime, durable job drain, Deep Research, Telegram, stores
apps/web/                React/Vite dashboard and QA regression script
api/                     Vercel API entrypoints
src/agents/heartbeat/    heartbeat LangGraph workflow, seeds, tools, memory, escalation
src/agents/debate/       debate graph, prompt, schema, events, tests
src/agents/information/  general information/retrieval agent and tool catalog
src/api/                 provider adapters for Alpaca, Exa, Finnhub, OpenRouter, Supermemory, Telegram
src/global/              model/runtime config, global tools, memory, usage, observability
src/runtime/             schemas and provider-agnostic Kairos store
src/trading/             paper-trading policy, schemas, store, and order boundary
src/notifications/       Telegram notification layer
documentation/           focused integration and operational docs
prd/                     product requirement docs for agent slices
spec.md                  product and architecture source of truth
```

## Development

Install dependencies:

```bash
bun install
```

Run the local API:

```bash
bun run dev:api
```

Run the web app:

```bash
bun run dev:web
```

Build the web app:

```bash
bun run build:web
```

Run tests or typechecks when needed:

```bash
bun run test
bun run typecheck
```

Schedule the production heartbeat drain through Upstash QStash:

```bash
bun run cron:upstash
```

## Environment

Start from `.env.example`, then configure only the providers you need for the workflow you are running. Important provider families include:

- OpenRouter for model calls.
- Exa for web/news research.
- Supermemory for persistent agent memory and optional mirroring.
- Alpaca for paper brokerage, portfolio, snapshots, and heartbeat ticker seeds.
- Finnhub for company news and optional market/research data.
- Supabase for hosted Kairos store persistence.
- Telegram for notification delivery.
- `CRON_SECRET` for authenticated job-drain scheduling.

## Safety boundaries

- Default to research, notification, and paper trading.
- Do not enable live order paths without explicit configuration and review.
- Preserve evidence, source metadata, model outputs, confidence, and decision rationale for escalations.
- Keep Supermemory mirroring compact and explicitly enabled.
- Keep Vercel Hobby cron limitations in mind: frequent five-minute drains should use an external scheduler such as Upstash rather than `vercel.json` crons.

## Documentation map

- `spec.md`: vision and architecture anchor.
- `AGENTS.md`: local workflow, implementation, and safety rules.
- `.codex/learning.md`: durable implementation learnings.
- `documentation/scheduling.md`: current production drain/scheduling notes.
- `documentation/supermemory*.md`: memory and mirroring behavior.
- `documentation/alpaca.md`, `documentation/finnhub.md`, `documentation/exa-ai.md`, `documentation/telegram.md`: provider-specific notes.
