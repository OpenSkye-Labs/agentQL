# M4 schema tools (PR #10)

Review rounds for PR #10. Moved from docs/REVIEWS.md per ADR-0003.

## 2026-10-11 — M4 FK click-through (Codex, `codex exec review --uncommitted`, 2 rounds)

| #   | Sev | Finding                                                                                      | Resolution                                                                                                   |
| --- | --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | P1  | FK jump into an already open table re-targeted its filter and `load()` dropped pending edits | Table tabs publish `dirty`; the jump (and the filter form) asks before discarding                            |
| 2   | P2  | SQLite `REFERENCES parent` without a column list yields an empty `ref_columns` entry         | Backend resolves omitted targets to the parent's primary key (`PRAGMA table_info`); grid skips malformed FKs |
| 3   | P2  | Binary key cells (`{ "$bytes": … }`) were quoted as JSON text                                | `sqlLiteral` renders `decode(…,'base64')` / `FROM_BASE64` / `X'…'` like the backend; self-checks added       |
| 4   | P2  | Postgres array-valued keys serialised as JSON                                                | Skipped: FKs cannot reference array columns in practice; noted with a `ponytail:` comment                    |

## 2026-10-11 — M4 ER diagram (Codex, `codex exec review --uncommitted`)

No findings on the diagram. The run also reviewed the in-progress schema diff files (not yet wired in); those findings
are logged under the schema diff entry below.

## 2026-10-11 — M4 schema diff (Codex, `codex exec review --uncommitted`, 2 rounds)

| #   | Sev | Finding                                                                                | Resolution                                                                                    |
| --- | --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | P1  | Diff tab not reachable (reviewed mid-increment)                                        | Wired: App route, connection menu "Schema diff…", schema menu "Compare schema…"               |
| 2   | P1  | Migration was written for B's schema/driver although it runs on A                      | Generated for A's schema and dialect; added tables are synthesised from metadata, not B's DDL |
| 3   | P2  | Cross-schema compare flagged every object because DDL carries the schema qualification | `normaliseDdl` strips the object's own qualification (outside string literals)                |
| 4   | P2  | Changed views emitted ALTER TABLE ADD/DROP COLUMN                                      | Column statements only for tables; views/matviews get B's definition as a review comment      |
| 5   | P2  | Removed materialized views used the plain view drop statement                          | Materialized views get their own drop statement                                               |
| 6   | P2  | Normalisation could rewrite `'a.example'` string literals                              | Replacement skips `'…'` literals                                                              |
| 7   | P2  | MySQL string defaults rendered unquoted (`DEFAULT pending`)                            | Literal-vs-expression heuristic quotes literals for mysql/mariadb (`ponytail:` comment)       |
| 8   | P2  | AUTO_INCREMENT dropped from synthesised columns                                        | `extra` preserved: AUTO_INCREMENT appended, other extras as inline comment                    |

## 2026-10-11 — M4 review panel (Claude subagents: correctness, security, requirements, maintainability, skeptic, judge) + Codex follow-up

Requirements: all M4 criteria met. Judge: 8/10 (advisory). Findings addressed before the PR's second push:

| #   | Source               | Finding                                                                                              | Resolution                                                                                     |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | security             | MySQL default heuristic let a crafted default from B become code in the copied migration             | Strict allow-list (numbers, NULL, CURRENT_*, bit literals) or `DEFAULT_GENERATED`; else quoted |
| 2   | security             | Names / view DDL in `--` comment lines could carry CR/LF or `*/` and break out                       | `oneLine()` on every interpolated name and comment line                                        |
| 3   | skeptic              | Postgres serial defaults (`nextval('a.seq'::regclass)`) made identical cross-schema tables "changed" | Regclass literals lose the schema prefix; column defaults compared normalised                  |
| 4   | skeptic, correctness | Exported SVG/PNG rendered in a serif font (`--font-mono` not resolved)                               | `font-mono` added to the inlined variables                                                     |
| 5   | correctness          | `fit()` while the tab is hidden produced a zero scale                                                | Fit returns false on a 0×0 viewport and retries via ResizeObserver when visible                |
| 6   | correctness          | Removed foreign tables emitted `DROP TABLE`                                                          | `DROP FOREIGN TABLE`                                                                           |
| 7   | correctness          | Diff footer labelled A/B from the live pickers, not the compared result                              | Result stores both sides                                                                       |
| 8   | maintainability      | Added tables lost their FKs and secondary indexes in the migration                                   | FKs emitted as `ALTER TABLE … ADD CONSTRAINT` after all CREATEs; indexes listed as comments    |
| 9   | maintainability      | `diff` tabs deduplicated and dropped the chosen schema; inline copy of `updateTab`                   | Diff tabs open fresh like query tabs; `openTab` reuses `updateTab`                             |
| 10  | Codex follow-up      | FK constraints inline in CREATE TABLE failed when the parent is created later / cyclic               | See #8                                                                                         |
| 11  | Codex follow-up      | FK references into other schemas were rewritten to the destination schema                            | `ref_schema` kept when it differs from the object's schema                                     |
| 12  | correctness          | `validate_filter` rejects FK keys containing `--`                                                    | Skipped: rare; the jump surfaces the backend error instead of running an unvalidated filter    |
| 13  | judge                | `Node`/`Edge` shadow DOM types; `MYSQL` predicate; decorative `QuoteDriver` union                    | Renamed `ErdNode`/`ErdEdge`/`isMysql`; `QuoteDriver = string` with a doc comment               |

## 2026-10-11 — M4 PR #10 (CodeRabbit, first pass: 7 comments)

| #   | Sev   | Finding                                                             | Resolution                                                           |
| --- | ----- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | minor | `fit()` stored scale 0 while the ERD tab was hidden                 | Already fixed from the panel round (guard + ResizeObserver)          |
| 2   | minor | Diagram nodes not reachable from the keyboard                       | `role="button"`, `tabIndex`, aria-label, Enter/Space opens the table |
| 3   | minor | Clipboard write failure still showed "copied"                       | Toast follows the promise; failures show an error toast              |
| 4   | minor | Diff footer read the live pickers instead of the compared result    | Already fixed from the panel round                                   |
| 5   | major | "Clear" on a filtered table discarded pending edits without asking  | Same dirty confirm as Apply                                          |
| 6   | minor | `ADD COLUMN … NOT NULL` without a default fails on populated tables | Added nullable with a backfill note; self-check added                |
| 7   | minor | Existing diff tab was reactivated without the new schema            | Already fixed from the panel round (diff tabs open fresh)            |

## 2026-10-11 — M4 PR #10 (CodeRabbit, second pass after the dev merge: 2 comments)

| #   | Sev   | Finding                                                                          | Resolution                                                                                          |
| --- | ----- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | major | SQLite rejects `ALTER TABLE … ADD CONSTRAINT`, so migrations with new FKs failed | SQLite inlines `CONSTRAINT … FOREIGN KEY` in CREATE TABLE (no parent-order check); others unchanged |
| 2   | minor | `validate_filter` rejected FK key values containing `--` or `/*`                 | Literal contents are blanked before the comment-marker check; unit test added                       |

## 2026-10-11 — M4 PR #10 (CodeRabbit, third pass after merging PR #7: 2 comments)

| #   | Sev   | Finding                                                                        | Resolution                                                                                                                                                                                                                                                                              |
| --- | ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | minor | `save_file` wrote to any path the webview sent (arbitrary-file-write sink)     | Rust re-checks the path: absolute and `.svg` / `.png` only                                                                                                                                                                                                                              |
| 2   | minor | `blank_string_literals` ended a literal at `\'`, disagreeing with the splitter | Backslash skips the next character inside a literal for MySQL/MariaDB only (`validate_filter` now takes the driver); on Postgres/SQLite `'a\'` stays a closed literal so a trailing `--` is still rejected (commit security scan flagged the dialect mismatch). Tests for both dialects |

## 2026-10-11 — M4 PR #10 (CodeRabbit, fourth pass after merging PR #8: 1 comment)

| #   | Sev   | Finding                                                                                                                             | Resolution                                                                                                                    |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | minor | `split_statements` escapes backslashes for every dialect, so a Postgres key with `\'` mis-split                                     | `validate_filter` splits the driver-aware literal-blanked text, so `;` inside a literal never splits; tests for both dialects |
| 2   | high  | Commit security scan: Postgres `E'…'` escape strings use backslashes, so `E'\'' ; …` could hide a second statement from the blanker | The blanker enables backslash escapes for a literal prefixed by a bare `E`/`e`; tests for `E'…'`, `e'…'` and a literal `'E'`  |
