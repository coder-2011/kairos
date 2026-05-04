# Kairos QA Issues

- `2026-05-03 17:08 — [qa-kairos] Feature: Supabase-backed UI QA startup | Severity: high | Environment: web`
- `Observed: KAIROS_STORE=supabase is set in .env.local and the Supabase kairos project was verified clear, but SUPABASE_SERVICE_ROLE_KEY is unset. Starting the local API in Supabase mode exits with "SUPABASE_SERVICE_ROLE_KEY is required when KAIROS_STORE=supabase." The existing API on 127.0.0.1:4321 reports mode "local", so it cannot be used to verify Supabase-backed persistence.`
- `Expected: The local API should start in Supabase mode with KAIROS_STORE=supabase, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY configured before creating The monitoring branch or running UI feature checks.`
- `Evidence: Supabase public.kairos_records row counts returned empty after cleanup; curl http://127.0.0.1:4321/health returned {"ok":true,"service":"kairos-local-api","mode":"local"}.`

# qa-kairos run 2026-05-04T00:29:52.255Z
- 2026-05-04 00:29 — [qa-kairos] Feature: Playwright runner crash | Severity: high | Environment: web
Observed: click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: /^Branch List$/i })[22m

Expected: QA runner should complete expected workflow steps
Evidence: 99-runner-error.png

# qa-kairos run 2026-05-04T00:31:06.069Z
- 2026-05-04 00:30 — [qa-kairos] Feature: Branch list empty state | Severity: med | Environment: web
Observed: Empty state did not show on a reset
Expected: First run should show no branches message
Evidence: /Users/namanchetwani/Projects/kairos/data/runtime/QA/01-01-branches-empty.png

- 2026-05-04 00:30 — [qa-kairos] Feature: Run heartbeat from config | Severity: high | Environment: web
Observed: No monitoring run appeared after heartbeat
Expected: Heartbeat should create a run in Monitoring
Evidence: /Users/namanchetwani/Projects/kairos/data/runtime/QA/04-04-monitoring-after-heartbeat.png

- 2026-05-04 00:31 — [qa-kairos] Feature: Playwright runner crash | Severity: high | Environment: web
Observed: click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('table.branch-table tbody tr').filter({ hasText: 'The monitoring twin' }).first()[22m

Expected: Full qa flow should run end-to-end
Evidence: /Users/namanchetwani/Projects/kairos/data/runtime/QA/07-99-runner-error.png


# qa-kairos run 2026-05-04T00:31:51.734Z
- 2026-05-04 00:31 — [qa-kairos] Feature: Heartbeat creates monitoring run | Severity: high | Environment: web
Observed: Run count was 0
Expected: Monitoring should show heartbeat run
Evidence: /Users/namanchetwani/Projects/kairos/data/runtime/QA/04-04-monitoring-after-heartbeat.png

- 2026-05-04 00:31 — [qa-kairos] Feature: Playwright harness crash | Severity: high | Environment: web
Observed: click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: /INJECT/i })[22m
[2m    - locator resolved to <button disabled type="button" class="command-button primary">INJECT</button>[22m
[2m  - attempting click action[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is not enabled[22m
[2m    - retrying click action[22m
[2m    - waiting 20ms[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is not enabled[22m
[2m    - retrying click action[22m
[2m      - waiting 100ms[22m
[2m    8 × waiting for element to be visible, enabled and stable[22m
[2m      - element is not enabled[22m
[2m    - retrying click action[22m
[2m      - waiting 500ms[22m
[2m    - waiting for element to be visible, enabled and stable[22m
[2m  - element was detached from the DOM, retrying[22m
[2m    - locator resolved to <button disabled type="button" class="command-button primary">INJECT</button>[22m
[2m  - attempting click action[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is not enabled[22m
[2m    - retrying click action[22m
[2m    - waiting 20ms[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is not enabled[22m
[2m    - retrying click action[22m
[2m      - waiting 100ms[22m
[2m    48 × waiting for element to be visible, enabled and stable[22m
[2m       - element is not enabled[22m
[2m     - retrying click action[22m
[2m       - waiting 500ms[22m

Expected: Full QA sequence should complete
Evidence: /Users/namanchetwani/Projects/kairos/data/runtime/QA/05-99-runner-error.png

