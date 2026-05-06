# Agent prompt audit

Date: 2026-05-06

This audit checked Kairos LLM calls against `spec.md` and
`documentation/building-agents.md`.

## Rubric

- Keep system prompts lean: role, context, tools, constraints, output.
- Put high-signal runtime context in the user message, ordered by importance.
- Separate trusted instructions from untrusted user/source/memory/tool data.
- Keep tool menus and tool outputs capped.
- Use structured outputs where downstream code depends on the result.
- Set max steps/tool-call budgets for agent loops.
- Default trading-sensitive agents to research, notification, and guarded
  trade intents, not execution.

## Inventory

- Heartbeat: `src/agents/heartbeat/prompt.ts`, called from
  `src/agents/heartbeat/agent.ts` with AI SDK structured output and a bounded
  tool loop.
- Debate judge/bull/bear/final: `src/agents/debate/prompt.ts`, called from
  `src/agents/debate/agent.ts` with LangChain structured output.
- Information planner/synthesizer: `src/agents/information/prompt.ts`, called
  from `src/agents/information/agent.ts` with LangChain structured output.
- Deep Research web/API: `apps/local-api/src/deep-research.ts`, called through
  AI SDK text and stream loops with explicit step, tool-call, and output-token
  limits.
- Telegram Deep Research: `apps/local-api/src/telegram-deep-research.ts`,
  wrapping Deep Research with stricter step/tool budgets.
- Notification formatter: `src/notifications/trading-telegram.ts`, a bounded
  chat-completion formatting call.
- Chat-title calls: `apps/local-api/src/server.ts` and
  `apps/local-api/src/deep-research.ts`, small deterministic title prompts.

## Changes made

- Added explicit trusted-task and untrusted-data boundaries to Heartbeat,
  Debate, Information, Deep Research, Telegram Deep Research, and notification
  prompts.
- Reordered Debate context into a clear packet: `trusted_task`, `caseFile`,
  `debateState`, `humanContext`, `transcript`, then `toolEvents`.
- Removed duplicated Debate portfolio context from the prompt packet.
- Removed frontend configuration guidance from the Information planner prompt
  packet because it does not help tool selection.
- Capped Deep Research prior-chat text before re-injection and wrapped runtime
  memory context separately from the current user request.
- Tightened title prompts so user/source text cannot steer hidden prompt output.

## Remaining guidance

- Keep Heartbeat output compact unless a concrete downstream consumer needs
  richer fields.
- Keep Debate receiving raw-enough case evidence for auditability, but prefer
  compact provider outputs before handoff.
- Add eval examples before major model upgrades or prompt rewrites.
