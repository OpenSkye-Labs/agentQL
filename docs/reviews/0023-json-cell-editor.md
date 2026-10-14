# JSON cell inspector/editor (PR #23)

Codex round 1 (`codex exec review --uncommitted`):

- P1 `inspectJson` read `cols[inspect.c].type_name` before the effect that clears a stale `inspect` ran, so a new
  result with fewer columns crashed the grid while the inspector was open — applied: same bounds guard as
  `inspectValue` (`inspectValue !== undefined`).
- P2 JSON drafts started from `cellFull`, which returns string scalars unquoted; saving an unchanged `hello`
  failed validation and `true`/`123` silently changed type — applied: JSON drafts start from
  `JSON.stringify(value, null, 2)` so every scalar round-trips through `parseCell` unchanged.

Codex round 2:

- P2 The read-only viewer was not contenteditable and had no `tabindex`, so it could not take keyboard focus for
  Ctrl+F or arrow scrolling — applied: `tabindex="0"` + `aria-readonly` on the read-only content element.
