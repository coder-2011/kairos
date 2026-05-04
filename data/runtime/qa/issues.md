2026-05-04 00:37 — [qa-kairos] Feature: Branches empty state | Severity: high | Environment: web
Observed: expect(locator).toBeVisible() failed

Locator: locator('td.empty-table-cell')
Expected: visible
Timeout: 12000ms
Error: element(s) not found

Call log:
  - Expect "to.be.visible" with timeout 12000ms
  - waiting for locator('td.empty-table-cell')

Expected: Branches list should open with empty-state message
Evidence: data/runtime/QA/fail-branches-empty-state.png
2026-05-04 00:37 — [qa-kairos] Feature: Create parallel branch for multi-track | Severity: med | Environment: web
Observed: expect(locator).toHaveCount(expected) failed

Locator:  locator('table.branch-table tr')
Expected: 3
Received: 5
Timeout:  5000ms

Call log:
  - Expect "to.have.count" with timeout 5000ms
  - waiting for locator('table.branch-table tr')
    9 × locator resolved to 5 elements
      - unexpected value "5"

Expected: Second branch can be created for stress/parallel track scenario
Evidence: data/runtime/QA/fail-create-parallel-branch-for-multi-track.png
