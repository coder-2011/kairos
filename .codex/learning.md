# Kairos Learning Log

- 2026-05-03: Agent workflows should be represented as explicit LangGraph graphs. The heartbeat agent now uses seed and model-triage LangGraph nodes while preserving the existing AI SDK/OpenRouter adapter inside the model node.
- 2026-05-03: Supermemory is the primary agent memory and retrieval backbone. Do not add local embedding/vector retrieval; keep local files for audit/replay and write meaningful runtime records through Supermemory when credentials are present.
- 2026-05-03: Live full-pipeline probes currently need credential/config guardrails: the available Finnhub key returns 403 for stock candles, the default heartbeat model `google/gemma-4-31b-it` cannot run tool-enabled heartbeat calls, and Supermemory can return 429 quota errors that block genuine memory-backed runs.
- 2026-05-03: Debate decisions are no longer buy-only. Final debate output carries a guarded action (`buy`, `sell`, `watch`, `research`, or `no_action`), debates receive compact cached portfolio context when available, and sell-side paper intents require known holdings.
