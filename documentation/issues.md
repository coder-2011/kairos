# UI/Runtime QA Issues

Last audited: 2026-05-03

Scope: cleared local branch/run/router runtime state, created one branch named `The monitoring`, then exercised branch configuration, heartbeat, human interjection, decision controls, manual debate, router routing across two temporary enabled branches, portfolio refresh, theme toggle, and desktop/mobile viewport checks.

## Findings

### 1. Heartbeat runs fail with the default configured model/tools

- Severity: High
- Status: Fixed
- Evidence: `data/runtime/qa/03-heartbeat-result.png`
- Observed: `RUN HEARTBEAT CHECK` creates a failed heartbeat run with: `OpenRouter model google/gemma-4-31b-it is not known to support tool calling`.
- Impact: Heartbeat tracking cannot actually run with the current default branch configuration because heartbeat tools are enabled by default while the resolved model is not tool-capable.
- Fix: The local API now detects when the resolved heartbeat model is not known to support tool calling, runs the heartbeat without tools, and sets the tool-step budget to `0`.

### 2. Router multi-branch wakeups hide failed heartbeat attempts in the Router sidebar

- Severity: High
- Status: Fixed
- Evidence: `data/runtime/qa/07-router-multiple-branches.png`
- Observed: Router successfully selected two branches and says it woke heartbeat agents for both, but the right `HEARTBEATS` panel still shows `0 RUNS` because failed heartbeat attempts are not included there.
- Impact: Multi-branch routing looks successful while hiding the most important operational result: both heartbeat wakeups failed.
- Fix: Router responses now include `heartbeatAttemptRuns` with successful and failed heartbeat run records. The web router sidebar uses that list and shows failed-run errors.

### 3. Monitoring summarizes successful router runs as `No output recorded`

- Severity: Medium
- Status: Fixed
- Evidence: `data/runtime/qa/08-monitoring-after-router.png`
- Observed: After a successful router run, Monitoring shows a router run card and event stream, but the run detail panel says `No output recorded`.
- Impact: The router result is harder to audit from Monitoring even though the run has meaningful routing output.
- Fix: Monitoring now summarizes router runs from `output.response` and includes routed branch and heartbeat failure counts.

### 4. Manual debate start can sit in `running` without visible progress

- Severity: High
- Status: Open
- Evidence: observed during manual debate QA after clicking `START MANUAL DEBATE`.
- Observed: A debate run was created and remained in `running` state for the QA window with no clear progress indicator or explanation.
- Impact: The UI does not clearly tell the user whether the manual debate is waiting on model credentials, an external API, or a runtime failure.
- Note: Not fixed in this pass. This likely needs debate workflow timeout/cancellation semantics and should be handled separately.

### 5. Supermemory mirror quota errors spam runtime logs during ordinary UI actions

- Severity: Medium
- Status: Fixed
- Evidence: local API logs during branch creation, heartbeat, interjection, debate, and router actions.
- Observed: Repeated `Supermemory mirror failed ... HTTP 429 ... API token limit reached` warnings appear for normal local actions.
- Impact: The UI mostly continues, but runtime observability is noisy and it is unclear from the UI whether memory persistence succeeded.
- Fix: The local API now throttles repeated Supermemory mirror warning logs by failure class for five minutes.

### 6. Mobile branch-list layout clips useful table context

- Severity: Medium
- Status: Fixed
- Evidence: `data/runtime/qa/12-mobile-branches.png`
- Observed: At `390x844`, the mobile branch list shows a very narrow icon-only nav and only the left portion of the branch table. Numeric page overflow checks report no horizontal scroll, but visually the table context is cut down to partial columns.
- Impact: Mobile users cannot comfortably inspect the branch list state, even though the layout technically reports no page overflow.
- Fix: The branch table now collapses into labeled row cards at the mobile breakpoint, preserving branch ID, law/name, heartbeat cadence, last run, and escalation count without horizontal clipping.

### 7. Branch configuration first viewport is visually dense

- Severity: Low
- Status: Open
- Evidence: `data/runtime/qa/02-the-monitoring-config.png`
- Observed: The first config viewport is dominated by long raw prompt textareas before the user reaches most operational controls.
- Impact: The page is functional, but it does not feel as clean as the rest of the app and makes the most common branch setup fields compete with advanced prompt internals.
- Note: Not fixed in this pass. This is a broader information architecture/design change rather than a small runtime bug fix.

## Passed Checks

- Final cleaned local runtime state contains exactly one branch: `The monitoring`.
- Final cleaned local runtime state contains zero runs and zero router chats.
- Branch creation, rename, law editing, ticker editing, and save worked through the UI.
- Human interjection worked on a selected run.
- Decision controls `WRONG`, `STALE`, and `USEFUL` appended human feedback events.
- Router selected multiple enabled branches when the submitted source matched both branch laws.
- Portfolio refresh rendered a clean paper/empty state.
- Theme toggle rendered a coherent light-mode branch list on desktop.
- Desktop viewport checks showed no page-level horizontal or vertical overflow for the captured app states.
