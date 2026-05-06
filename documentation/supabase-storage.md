# Supabase storage

Kairos can use Supabase instead of local files for the records that the local
API previously stored under `data/runtime`.

## Minimal schema

Apply `documentation/supabase-kairos-store.sql` to the target Supabase project.
It creates one table:

```text
public.kairos_records
```

Each row stores:

- `collection`: logical record type, for example `branches`, `runs`, or
  `trade_intents`
- `id`: record ID
- `record`: the full Kairos JSON payload
- `created_at` / `updated_at`: database bookkeeping timestamps

This is deliberately generic so branch config, run outputs, traces, and trading
records can evolve without a migration for every TypeScript schema change.

## Runtime configuration

Set these environment variables for the local API:

```sh
KAIROS_STORE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side service role key>
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the web app. It is only for the
local API/server process.

The bootstrap SQL grants `select`, `insert`, `update`, and `delete` only to the
`service_role` role because the local API talks to Supabase server-side. Do not
grant browser roles access to `public.kairos_records` unless the app design
changes and row-level policies are reviewed.

If `KAIROS_STORE` is not `supabase`, Kairos keeps using local file storage.
