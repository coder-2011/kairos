# Supermemory mirroring

Kairos treats Supabase/local storage as the audit log and Supermemory as compact
agent-usable memory. The mirror must stay small because Supermemory counts every
document and memory write against monthly quota.

## Defaults

Supermemory mirroring is disabled unless both are true:

- `SUPERMEMORY_API_KEY` is set
- `KAIROS_SUPERMEMORY_MIRROR_ENABLED=1`

`KAIROS_SUPERMEMORY_REQUIRED=1` does not enable the mirror by itself. It only
makes API writes fail if Supermemory rejects a mirror write after
`KAIROS_SUPERMEMORY_MIRROR_ENABLED=1` is also set.

The default mirror mode is intentionally cheap:

- one compact Supermemory memory write per mirrored record
- one primary container tag per record
- compact memory text capped to 900 characters
- full formatted record text capped internally before any document-mode use

## Rules

- Mirror compact summaries, identifiers, timestamps, branch IDs, and decisions.
- Do not mirror full run objects, full event objects, full seed bundles, prompt
  configs, provider raw payloads, or large source text by default.
- Keep raw replay data in Supabase/local storage.
- Prefer the branch profile container for branch-scoped records. Do not duplicate
  every record into global, raw branch, and profile containers unless there is a
  concrete retrieval need and a budget increase.
- Treat delete as a tombstone memory. Kairos branch deletion does not physically
  delete or forget old Supermemory records.

## Metering

The mirror records a `supermemory` usage event with operation
`mirror.estimate` before each write. It includes:

- `containerCount`
- `documentWrites`
- `memoryWrites`
- `contentChars`
- `memoryChars`
- estimated token `quotaUnits`
- `branchId` / `runId` when available

Use these estimates for budget dashboards and before enabling higher-volume
workflows.
