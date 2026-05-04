---
name: qa-kairos
description: "Use this when the user asks for Kairos cleanup + full UI QA: clear runs/chats/branches, create a monitoring branch, run interactive feature checks, and log defects only."
---

# QA Kairos

Use this workflow when the user wants a destructive reset-and-verify pass for the Kairos app. It is explicitly for manual QA and issue logging, not bug fixing.

## Preconditions
- Run from the Kairos repo root (`/Users/namanchetwani/Projects/kairos`).
- Keep the web app started at the expected URL for `playwright` (default `http://127.0.0.1:4321` unless user specifies).
- Keep a fresh workspace note for timestamped `data/runtime/QA/issues.md` entries.
- Do not edit files outside the QA scope unless user explicitly adds scope.

## Core intent
- Clear all of: runs, router chats, and branches that were created during the session.
- Create one new branch named `The monitoring`.
- Validate all implemented front-end features in one pass and check visual cleanliness at every inspected state.
- Log every defect (functional, visual, edge-case) to `data/runtime/QA/issues.md` only; do not patch/resolve.

## Workflow

1. Build a QA inventory once before execution.
   - Pull implemented user-facing features from the user request and codebase.
   - For each item, list: control/state, expected result, and a screenshot evidence point.
   - Include off-path checks (error and concurrent state).

2. Clear runtime data.
   - Use `$supabase` to inspect and clear persistence entities:
     - branches
     - run records / run events
     - router chats/messages
     - deep research chats/messages if present
   - If the local filesystem is the active store in this project, also remove matching local artifacts (usually under `data/runtime/`).
   - Verify `git status`/counts after clear.

3. Start the app session and attach playwright.
   - Use `$playwright-interactive`.
   - Run one-pass bootstrap and use stable handles.
   - Confirm app loads, then keep `page` session across checks.

4. Create `The monitoring` branch.
   - Go to Branches view, create a new branch with exactly `The monitoring`.
   - Save it and mark it as active.
   - Capture initial screenshot immediately and state whether layout/spacing/labels are clean.

5. Feature checks.
   - Monitoring screen:
     - open/close tracks
     - start heartbeat/refresh flows
     - run force actions where available
     - attempt parallel track runs on at least two branches.
   - Branch list/router workflow:
     - create, edit, and save draft branch behavior
     - force-delete branch if supported in this branch state
     - verify empty/error fallback states.
   - Debate and manual escalation:
     - trigger manual debate from a created branch
     - inject human context / interruption text where available
     - complete at least one pass to verdict/action.
   - Deep Research:
     - start research chat
     - switch model
     - send a short prompt
     - verify transcript + tool-call output rendering.

6. UI-clean checkpoints.
   - At every control interaction and post-state, capture a screenshot.
   - After each screenshot, explicitly evaluate cleanliness:
     - readable text
     - no clipping in primary controls
     - no obvious contrast/spacing/overflow defects
     - stable layout in target viewport.
   - Ask this checkpoint question explicitly:
     - “Is this UI clean here?”

7. Off-path checks.
   - Trigger at least two stress/edge checks:
     - rapid multiple starts/stops
     - stale/empty-state transitions
     - invalid input or force-stop interruption

8. Consolidate evidence.
   - For each inventory item mark: passed/failed/skipped.
  - For every failed or risky behavior, append a timestamped entry to `data/runtime/QA/issues.md` with reproduction steps and observed vs expected.
  - Ensure `data/runtime/QA` exists before logging; create it if missing.

9. Cleanup and handoff.
   - Keep playwright session alive only if follow-up is required.
   - If done, close browser/session via `$playwright-interactive` cleanup flow.
   - Return a concise signoff with checked items, coverage gaps, and open issues.

## Issue logging format (`data/runtime/QA/issues.md`)
Use this exact concise format:
- `YYYY-MM-DD HH:MM — [qa-kairos] Feature: <feature> | Severity: <low|med|high> | Environment: <web/mobile>`
- `Observed: ...`
- `Expected: ...`
- `Evidence: <screenshot label/file or steps>`

## Failure handling
- If a requested clear step can’t be performed safely, stop mutation and log:
  - blocked action
  - missing command/permission
  - reason it is not safe to continue
- Do not attempt hotfixes.

## Completion rules
- Pass only if all required features were exercised and evidence is attached.
- Never claim pass if any required inventory item is unverified.
- Mention explicitly what was not covered and why.
