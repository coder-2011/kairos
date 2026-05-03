# Kairos Learning Log

- 2026-05-03: Agent workflows should be represented as explicit LangGraph graphs. The heartbeat agent now uses seed and model-triage LangGraph nodes while preserving the existing AI SDK/OpenRouter adapter inside the model node.
- 2026-05-03: Supermemory is the primary agent memory and retrieval backbone. Do not add local embedding/vector retrieval; keep local files for audit/replay and write meaningful runtime records through Supermemory when credentials are present.
