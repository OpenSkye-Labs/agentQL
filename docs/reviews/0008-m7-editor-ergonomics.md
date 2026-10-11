# M7 editor ergonomics (PR #8)

Review rounds for PR #8. Moved from docs/REVIEWS.md per ADR-0003.

## 2026-10-11 — M7 editor ergonomics (Codex, `codex exec review --base dev`)

Round 1: 3 findings (all P2), all fixed with a self-check in `pnpm check`:

| #   | Sev | Finding                                                                                                                              | Resolution                                                                                                                             |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2  | `statementStart` treated the doc-end sentinel as a statement start, so Ctrl+Space at the end of the doc lost the JOIN/clause context | Sentinel excluded; checks for end-of-doc and "after `;`" positions                                                                     |
| 2   | P2  | Generated JOIN clauses inserted unquoted mixed-case identifiers (Postgres folds them to lowercase)                                   | `ident()` quotes anything that is not plain lowercase with the dialect's quote (`"` / `` ` ``); aliases keep the quotes the user typed |
| 3   | P2  | Reverse FKs owned by another schema were skipped for a schema-qualified table                                                        | Source-schema filter only on forward matches; cross-schema referencing tables are emitted schema-qualified                             |

Round 2: 3 findings (all P2), all fixed with self-checks:

| #   | Sev | Finding                                                                                                   | Resolution                                                                                       |
| --- | --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 4   | P2  | Column completions inserted unquoted mixed-case names (`c.candidateId`), which Postgres folds             | Column completions carry a dialect-quoted `apply`; lang-sql already quotes table names itself    |
| 5   | P2  | `FROM audit.orders o JOIN` suggested a bare `customers` although the user is outside the search path      | Join targets stay schema-qualified whenever the source reference was qualified or schemas differ |
| 6   | P2  | The alias regex consumed `JOIN` as a (rejected) alias, so `FROM orders JOIN customers c` lost `customers` | Alias group refuses clause keywords with a negative lookahead; scan resumes at the keyword       |

Round 3: 2 findings (P2), both fixed:

| #   | Sev | Finding                                                                                         | Resolution                                                                                                                  |
| --- | --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 7   | P2  | `Mod+/` is CodeMirror's comment toggle, so opening the shortcut dialog also commented the query | Dialog moved to `Mod+Shift+/`; the reference lists both                                                                     |
| 8   | P2  | SQLite `REFERENCES parent` without a column list yields an empty target column → `c."" = o.x`   | `table_details` resolves the parent's primary key (shared by TableTab and the catalog); non-ignored test in `tests/live.rs` |

Round 4: 1 finding (P2), fixed:

| #   | Sev | Finding                                                                     | Resolution                                                                                   |
| --- | --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 9   | P2  | Keyword/snippet source also fired inside strings and comments (`SELECT 'F`) | Source wrapped in `ifNotIn` with the same node list lang-sql uses for its keyword completion |

Round 5: 2 findings (P2), both fixed:

| #   | Sev | Finding                                                                              | Resolution                                                                                                              |
| --- | --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 10  | P2  | Every saved query went through the snippet parser, so `'${HOME}'` loaded as `'HOME'` | `isSnippet()` (numbered placeholders only) decides between snippet load and verbatim load; same for trigger completions |
| 11  | P2  | Sidebar table listing waited for the whole-schema catalog (slow on big SQLite files) | Tables are published first; the catalog loads independently and merges when it arrives                                  |

Round 6: 2 findings (P2), both fixed:

| #   | Sev | Finding                                                                                             | Resolution                                                                                    |
| --- | --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 12  | P2  | A numbered snippet that also contains `'${HOME}'` lost the literal braces                           | `snippetTemplate()` escapes every non-numbered `${…}` / `#{…}` before the snippet parser runs |
| 13  | P2  | Catalog FK columns were comma-joined and re-split, so a column named `a,b` broke the JOIN predicate | Postgres returns `array_agg` (decoded as an array); MySQL joins on the ASCII unit separator   |

Round 7: clean ("No actionable regressions were identified"). Live Postgres/MySQL checks of the catalog SQL still to
be done against the docs/TESTING.md containers (no Docker on the authoring machine).

CodeRabbit on PR #8 (3 minor), all fixed: MySQL FK catalog no longer uses `GROUP_CONCAT` (one row per key column,
folded in Rust → no `group_concat_max_len` truncation); `submitSave` toasts on failure and closes only after the
save succeeds; catalog responses carry a per-connection/schema sequence so a slow older response cannot overwrite a
newer one after `refreshSchema` or reconnect. Codex follow-up: a pending guard disables Save/Enter while the write is in flight.
