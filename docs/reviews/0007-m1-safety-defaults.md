# M1 safety defaults (PR #7)

Review rounds for PR #7. Moved from docs/REVIEWS.md per ADR-0003.

## 2026-10-11 — M1 safety defaults (Codex, `codex exec review --uncommitted`)

Scope: run-all confirmation, environment tag, production write confirmation (`classify_sql`). 2 findings, both addressed:

| #   | Sev | Finding                                                                                                      | Resolution                                                                                                                                     |
| --- | --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1  | Parse-failure fallback whitelisted `SELECT`/`EXPLAIN`, so `SELECT … INTO t; select '` skipped the prompt     | Script is re-parsed statement by statement; a statement the parser rejects is reported as a write (`<KEYWORD> (could not parse)`). Test added. |
| 2   | P2  | Writes inside queries (`SELECT INTO`, modifying CTEs, `EXPLAIN ANALYZE UPDATE`) showed only `WITH`/`EXPLAIN` | `describe_write` walks CTEs, set members and analyzed statements and names the inner kind + table. Test added.                                 |

Also fixed while here: `statement_is_read_only` now holds the full read-only match (SHOW/PRAGMA/...) and `is_read_only`
delegates to it, so the two classifiers cannot drift.

## 2026-10-11 — M1 safety defaults, round 2 (Codex + in-session reviewer panel)

Codex (`codex exec review --uncommitted`), 2 findings, both addressed; panel (correctness / security / requirements /
maintainability / skeptic), 6 actionable findings, all addressed:

| #   | Sev  | Finding                                                                                                                                 | Resolution                                                                                                                                          |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2   | Only the first modifying CTE was listed                                                                                                 | `describe_writes` returns every write of a statement; CTEs and set members are all walked. Test added.                                              |
| 2   | P2   | MySQL multi-table DELETE (`DELETE orders FROM users JOIN orders`) named `users`                                                         | Explicit delete targets win over the FROM table. Test added.                                                                                        |
| 3   | high | Classifier parsed the whole script, executor runs `split_statements` pieces; nested `/* */` and MySQL mid-line `#` comments hid a write | Classification now runs per `split_statements` piece (same unit as `Sql::run`); a piece with code that parses to nothing fails closed. Tests added. |
| 4   | high | Postgres `EXPLAIN (ANALYZE) <write>` parsed with `analyze: false` (option list) and counted as read-only                                | Any `ANALYZE` utility option counts as analyze. Test added; `is_read_only` covered too.                                                             |
| 5   | med  | `SELECT … INTO` inside a UNION arm was read-only; two parallel query walkers could drift                                                | `query_is_read_only` / `statement_is_read_only` deleted; `is_read_only` is now `classify_writes(..).is_empty()`.                                    |
| 6   | med  | MySQL `/*! … */` executable comments invisible to splitter and parser                                                                   | Any `/*!` on MySQL/MariaDB is reported as `EXECUTABLE COMMENT` (fail closed).                                                                       |
| 7   | med  | Select-all + Cmd/Ctrl+Enter ran a whole script with no count prompt (count keyed on the button, not the text)                           | Statement count is taken from the text about to run, selection included.                                                                            |
| 8   | med  | Multi-target DROP / TRUNCATE named only the first object                                                                                | All targets joined.                                                                                                                                 |
| 9   | low  | `classify_sql` IPC failure was an unhandled rejection; double Cmd+Enter opened two prompts                                              | try/catch with a toast (still fails closed); in-flight guard before the await. Control characters stripped from prompt text.                        |
| 10  | low  | Rust stored `environment` as a free string while TS had a closed union                                                                  | `enum Environment { Dev, Staging, Production }` with `rename_all = "lowercase"`.                                                                    |
| 11  | low  | On production, "Preview SQL" and "Apply" did the same thing                                                                             | Preview hidden on production; button reads "Review & apply".                                                                                        |

Skipped (documented instead): Redis/Mongo writes on production get no prompt (SQL-only by the M1 wording; follow-up on the
task board, dialog hint says "badge only" for those drivers); function side effects inside SELECT are undetectable
statically (noted in FEATURES.md); the TS statement counter ignores `$$` quoting so a function body can inflate the count
(misleading count only, never a missing prompt).

## 2026-10-11 — M1 safety defaults, round 3 (Codex)

2 findings, both addressed:

| #   | Sev | Finding                                                                                                                  | Resolution                                                                                                          |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | P2  | TS statement counter ignored `$$` dollar quoting, so `select $$'$$; select 2` counted as one statement                   | `statementBounds` skips `$$…$$` / `$tag$…$tag$` like the backend splitter (also fixes `statementAt`). Checks added. |
| 2   | P2  | `inFlight` was only set once `run` started, so a second shortcut press during classification could queue a duplicate run | A `guarding` ref is held across classification + confirmation and released in `finally`.                            |

## 2026-10-11 — M1 safety defaults, round 4 (Codex)

1 finding, addressed: an unmatched dollar tag (MySQL `$$` identifier) swallowed the rest of the script in the TS splitter,
merging statements. The splitter now only skips a dollar-quoted region when it finds the closing tag, like the backend.
Check added.
