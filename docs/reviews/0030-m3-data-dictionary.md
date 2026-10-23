# Data dictionary the agent reads (PR #30)

Reviewed with the alleo-loop panel (correctness, requirements, maintainability, skeptic, security) plus a Codex
cross-check (`codex exec --sandbox read-only` on the branch diff). 0 blockers; every finding below was applied.

Codex cross-check: 2 findings, both applied.

- Medium (also the skeptic's strongest objection and a correctness finding, so three reviewers independently):
  `save_note` checked names case-insensitively on SQLite (`scope.same`, `PRAGMA table_info`) but stored the agent's
  spelling, so an approved note on `Orders.Status` never showed in the structure tab (exact match), and a later UI edit
  of `orders.status` created a second note while `describe_table` kept returning the stale one — applied: the tool
  resolves schema, table and column to the catalog's spelling (`schemas()`, `tables()`, `table_details()`) before
  building the note, and refuses names that do not exist.
- Medium: the metric form split `schema.table` text at the first dot, so a Postgres schema `"sales.eu"` saved the
  metric on schema `sales`, table `eu.orders` — applied: the form picks from the loaded tables and keeps schema and
  table as separate values; the notes tab also groups by a NUL-joined key instead of `schema.table`.

Security reviewer: 2 should-fix, 2 nits, all applied.

- The approval card showed the raw note in a scrolling `<pre>` while the prompt collapses whitespace, so an injected
  instruction could hide below hundreds of blank lines and persist into every later session — applied:
  `Note::normalized` stores one line (what the card and the prompt both show), notes are capped at 2000 characters,
  for the UI and the agent alike.
- Agent-supplied metric names were unvalidated and rendered verbatim into the prompt — applied: one line, no control
  characters, at most 64 characters.
- Consent text said notes are sent "for those tables" (inspected ones), but the prompt sends every in-scope note —
  applied: "for tables in scope".
- Overwriting an existing note showed only the new text — applied: the card adds "Replaces: …".

Correctness reviewer: 1 more finding, applied.

- The chat timeline said "Saved note on …" while the approval card was still waiting (no result yet) — applied:
  "Proposed note on …" until the tool returns.

Skeptic: 3 more points, applied.

- Agent-side notes file I/O ran on the tokio runtime (CLAUDE.md rule) — applied: `load_notes` and the save go through
  `spawn_blocking`; `delete_connection` deletes notes through the existing `blocking` helper.
- A failed inline save left the input open but unfocused because it was `disabled` while saving — applied: `readOnly`.
- Deleting a note in the notes tab had no confirmation — applied: `confirm()`, as elsewhere in the app.

Maintainability reviewer: 3 findings, applied.

- `notes_file` copied `push_history`'s strict JSON read — applied: one `Store::read_strict` used by both.
- The menu gate hard-coded the SQL driver list — applied: `isSql(conn.driver)`.
- `save_note` read `text` by hand — applied: `str_arg`.

Requirements reviewer: all 11 acceptance criteria met by code reading. Gaps it raised: this log (added), the
`tableKind` of a view opened from the notes tab (applied: taken from the loaded table list), and the save_note card
path, which was only exercised by code reading (no scripted mock run exists for it). Not done: an automated test for
the out-of-scope `save_note` refusal (it needs a live connection; the scope check is the same `table_allowed` the
render test covers). `notes_are_one_line_and_bounded` was written with its fix, so it never ran red.
