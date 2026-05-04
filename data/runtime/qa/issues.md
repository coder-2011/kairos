# Kairos QA Issues

- `2026-05-03 17:08 — [qa-kairos] Feature: Supabase-backed UI QA startup | Severity: high | Environment: web`
- `Observed: KAIROS_STORE=supabase is set in .env.local and the Supabase kairos project was verified clear, but SUPABASE_SERVICE_ROLE_KEY is unset. Starting the local API in Supabase mode exits with "SUPABASE_SERVICE_ROLE_KEY is required when KAIROS_STORE=supabase." The existing API on 127.0.0.1:4321 reports mode "local", so it cannot be used to verify Supabase-backed persistence.`
- `Expected: The local API should start in Supabase mode with KAIROS_STORE=supabase, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY configured before creating The monitoring branch or running UI feature checks.`
- `Evidence: Supabase public.kairos_records row counts returned empty after cleanup; curl http://127.0.0.1:4321/health returned {"ok":true,"service":"kairos-local-api","mode":"local"}.`
