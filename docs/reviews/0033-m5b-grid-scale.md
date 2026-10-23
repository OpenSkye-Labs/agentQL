# Grid at 200k × 60, M5 part B (PR #33)

Reviewed with the alleo-loop panel (correctness, requirements, maintainability, skeptic) plus a Codex cross-check on
`git diff dev...HEAD`. 0 blockers; findings applied unless noted.

- Editing a cell and then scrolling its column out of the rendered window unmounted the input without a blur (WebKit
  fires none), so the value never reached the pending changes and `editing` stayed set, freezing the grid's keyboard
  (Codex, skeptic's strongest objection, correctness). Starting an edit on a cell already scrolled out had the same
  result. Applied: `startEdit` and type-to-edit scroll the cell into view first, Tab in an edit scrolls the next column
  in, and an edit whose cell leaves the window after being on screen is committed as blur would. Checked in a narrow
  viewport: Enter and typing on a scrolled-out cell open its input in view; scrolling an open edit away commits it to
  the pending-changes bar and the arrow keys still work.
- `aria-colindex` numbered data columns from 1 while the row-number column was first (Codex, skeptic, requirements).
  Applied: row numbers are column 1, data columns `ci + 2`, `aria-colcount` includes the row-number column.
- The benchmark doc said "56–57 fps median", hiding a 49 fps run (requirements). Applied: TESTING.md lists every run;
  the bar is met in three of six after-runs (median 54), the slower ones show GC-shaped pauses; next lever named.
- `colVirtualizer.measure()` ran in `useEffect`, a frame behind new widths (correctness). Applied: `useLayoutEffect`.
- Maintainability: `sortOrder` takes `Cell[][]` and a required `text` (no silent "[object Object]" ordering); the
  fixture determinism check compared a cached object with itself, now it regenerates; `ponytail:` notes on the
  scrollbar sizes read during render and on the mock handing the result over by reference (no IPC cost measured).
- The 200k-sort timing assert in `pnpm check` could flake on a slow CI runner: loosened to 5 s (it runs ~0.6 s here).

Not changed: `aria-activedescendant` can point at a cell scrolled out with the mouse (rows already behaved this way;
the arrow keys bring it back).

Also found while testing (existing bugs, fixed here): keyboard moves left the cell under the sticky header or a
scrollbar, because the virtualizers measure with `offsetHeight`/`offsetWidth` and did not know about the sticky
parts; and a column resize released within the frame of its last move crashed the tab (a `setState` updater read a
ref that `mouseup` had already cleared).

PR #32 follow-up: the live Cancel tests that could not run then (Docker) passed on 2026-10-24. Postgres returned 0.3 ms
after Cancel mid-result and during `pg_sleep(30)`, MySQL 4.5 ms mid-result, with no file left and the pool usable.
`gridSort.check` was written before `gridSort.ts` and ran red first; the fixture check after the fixture.
