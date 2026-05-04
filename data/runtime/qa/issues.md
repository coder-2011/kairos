2026-05-04 00:40 — [qa-kairos] Feature: 07-Deep-research | Severity: med | Environment: web
Observed: click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('.deep-research-controls .react-select__control, .deep-research-controls [role="combobox"]').first()[22m
[2m    - locator resolved to <input value="" tabindex="0" role="combobox" inputmode="none" aria-haspopup="true" aria-readonly="true" aria-expanded="false" aria-autocomplete="list" id="react-select-3-input" class="css-1s80ejz-dummyInput-DummyInput"/>[22m
[2m  - attempting click action[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is visible, enabled and stable[22m
[2m      - scrolling into view if needed[22m
[2m      - done scrolling[22m
[2m      - element is outside of the viewport[22m
[2m    - retrying click action[22m
[2m    - waiting 20ms[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is visible, enabled and stable[22m
[2m      - scrolling into view if needed[22m
[2m      - done scrolling[22m
[2m      - element is outside of the viewport[22m
[2m    - retrying click action[22m
[2m      - waiting 100ms[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is visible, enabled and stable[22m
[2m      - scrolling into view if needed[22m
[2m      - done scrolling[22m
[2m      - element is outside of the viewport[22m
[2m    - retrying click action[22m
[2m      - waiting 500ms[22m
[2m    - waiting for element to be visible, enabled and stable[22m
[2m  - element was detached from the DOM, retrying[22m

Expected: Deep research chat should render prompt composer and accept prompt
Evidence: data/runtime/QA/fail-07-Deep-research.png
2026-05-04 00:41 — [qa-kairos] Feature: 10-Branch-delete | Severity: med | Environment: web
Observed: click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByText('The monitoring').first()[22m

Expected: Discarding branches should remove rows and return to empty-state if all deleted
Evidence: data/runtime/QA/fail-10-Branch-delete.png
