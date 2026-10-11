# M2 AI trust and audit (PR #9)

Review rounds for PR #9. Moved from docs/REVIEWS.md per ADR-0003.

## 2026-10-11 — M2 AI trust and audit, Codex round 1 (`codex exec review --uncommitted`)

6 findings (4 P1, 2 P2), all addressed:

| #   | Sev | Finding                                                                          | Resolution                                                                                     |
| --- | --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | P1  | Scope read from the live session's config snapshot, stale until reconnect        | Tools and system prompt read the stored connection on every call (`stored_scope`)              |
| 2   | P1  | Unqualified table names matched by name in any allowed schema (search_path leak) | Resolved as `<current_schema>.<name>` and must exist there (`SqlConn::current_schema`)         |
| 3   | P1  | CTE names excluded globally across statements/subqueries                         | Visitor tracks `WITH` frames lexically (non-recursive CTEs see only earlier ones); tests added |
| 4   | P1  | Case-insensitive identifier compare lets `"Users"` pass as `users`               | Identifiers normalised per dialect (Postgres folds unquoted), exact compare except SQLite      |
| 5   | P2  | Consent wrote back a connections list captured before the wait                   | List reloaded after approval; only the consent field is written                                |
| 6   | P2  | Chart queries skipped the audit history                                          | `run_agent_chart` shares scope check + history recording with `run_sql`                        |

## 2026-10-11 — M2 AI trust and audit, Codex round 2

4 findings (3 P1, 1 P2), all addressed:

| #   | Sev | Finding                                                                 | Resolution                                                                                                                                                                     |
| --- | --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P1  | `127.example.com` counted as local via hostname prefix                  | Host parsed as an IP; only loopback/unspecified addresses, `localhost`, `*.localhost`, `host.docker.internal` are local; unit test                                             |
| 2   | P1  | Table-function names excluded globally (`generate_series` table)        | Only the function's own name node is skipped (pointer identity); test added                                                                                                    |
| 3   | P1  | `query_to_xml('select * from private.secret')` bypasses the table check | Dynamic-SQL / file-reading functions (`query_to_xml`, `dblink`, `pg_read_file`, `load_file`, …) refused while a scope is set; `referenced_tables` now reports called functions |
| 4   | P2  | `explain_sql` executions missing from the audit history                 | EXPLAIN (and EXPLAIN ANALYZE) recorded like `run_sql`                                                                                                                          |

## 2026-10-11 — M2 AI trust and audit, Codex round 3 (+ automated security review)

3 findings (1 P1, 2 P2) plus one security-review note, all addressed:

| #   | Sev | Finding                                                             | Resolution                                                                                                                                                                             |
| --- | --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1  | `"query_to_xml"(...)` (quoted) dodged the function blocklist        | Function names built from identifier values (quotes dropped, lowercased); test added                                                                                                   |
| 2   | P2  | SQLite `pragma_table_info('secret')` leaks excluded metadata        | Any `pragma_*` function refused while a scope is set                                                                                                                                   |
| 3   | P2  | Scope narrowed while a write approval was pending still executed    | Scope reloaded and re-checked after approval, right before execution                                                                                                                   |
| 4   | sec | Blocklist incomplete; MySQL `/*! */` bodies invisible to the parser | Added `pg_stat_file`, `pg_ls_logdir`, `pg_ls_waldir`, `ts_stat`, `lo_open`, `loread`; `/*!` and `/*+` refused while scoped. Allowlist of pure functions remains the named upgrade path |

## 2026-10-11 — M2 AI trust and audit, CodeRabbit on PR #9

3 comments, all addressed:

| #   | Finding                                                                                         | Resolution                                                                                              |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Rejoining statements with `;\n` lets a trailing `--` comment swallow the separator              | Separator on its own line (`\n;\n`)                                                                     |
| 2   | `SHOW CREATE TABLE` / `SHOW TABLES` carry no visited relation, so a scope let them through      | Statements the visitor cannot see into (SHOW, DESCRIBE, PRAGMA, …) are refused while scoped; test added |
| 3   | Scope dialog saved the whole stale connection config, could clobber a consent granted meanwhile | Narrow `set_agent_scope` command updates only that field                                                |
| 4   | `LIMIT limit` capped the database at exactly the client limit, so `truncated` never fired       | `run_sql` pushes `LIMIT limit + 1`; the client row loop still truncates at `limit`                      |
| 5   | A corrupt `history.json` read as empty, so the next push replaced the whole history             | `push_history` errors when the file exists but does not parse; nothing is overwritten                   |
| 6   | Mock `set_agent_scope` did not update the in-page connection list                               | Mock handler persists the scope on its connection so a reload shows it                                  |
| 7   | Any read error on `history.json` (not just a missing file) started an empty list                | Only `NotFound` starts empty; other I/O errors propagate and leave the file untouched                   |
