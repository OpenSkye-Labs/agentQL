# Review log

Each entry: date, scope, reviewer, findings, resolution. Raw Codex output is kept under `.agent/` (git-ignored).

## 2026-10-10 — Backend review #1 (Codex, `codex exec`, read-only sandbox)

Scope: all of `src-tauri/src` after the first backend commit (201189b). 22 findings (7 high, 12 medium, 3 low). All addressed:

| #   | Sev  | Finding                                                                                   | Resolution                                                                                                                                                                                              |
| --- | ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | high | `is_read_only` accepted every EXPLAIN / PRAGMA (EXPLAIN ANALYZE DELETE, PRAGMA x=1 wrote) | EXPLAIN is read-only unless ANALYZE wraps a write; PRAGMA with a value is a write. Tests added.                                                                                                         |
| 2   | high | Parse failures fell back to first-keyword check                                           | Fail closed: only bare `SHOW`/`DESCRIBE` pass when unparseable.                                                                                                                                         |
| 3   | high | `SELECT nextval()` etc. treated as read-only                                              | New `run_read_only` executes inside `SET TRANSACTION READ ONLY` / `START TRANSACTION READ ONLY` / `PRAGMA query_only`; used by agent reads, table browsing, charts, EXPLAIN, and read-only connections. |
| 4   | high | Table filter allowed `0; DELETE …` on SQLite                                              | `validate_filter` requires one expression without `;`/comments, plus DB-enforced read-only execution.                                                                                                   |
| 5   | high | Mongo aggregate/command ignored `read_only`                                               | `$out/$merge` rejected; `run_command` limited to a read-command allowlist on read-only connections.                                                                                                     |
| 6   | high | Chart sources / mongo writes skipped approval when writes allowed                         | Chart sources are always read-only; `$out/$merge` pipelines go through the approval flow.                                                                                                               |
| 7   | high | SSH accepted any host key                                                                 | Trust-on-first-use pinning in `ssh_known_hosts.json`; changed keys are rejected with a hint; `ssh_forget_host` command to reset.                                                                        |
| 8   | med  | Secret fallback file world-readable                                                       | Written with 0600 (dir 0700) on Unix.                                                                                                                                                                   |
| 9   | med  | Stale keychain value could shadow a fallback write; delete errors ignored                 | Fallback read first; `NoEntry` treated as successful delete.                                                                                                                                            |
| 10  | med  | URL passwords persisted in connections.json                                               | `save_connection` strips the password into the secret store; drivers re-inject it at connect.                                                                                                           |
| 11  | med  | MySQL JSON literal backslash escaping                                                     | JSON values now go through the string literal path (backslashes escaped). NO_BACKSLASH_ESCAPES noted as a ceiling.                                                                                      |
| 12  | med  | Postgres arrays/bytes always cast to `::jsonb`                                            | `literal_typed` uses column type hints: Postgres array literals, `decode(…, 'base64')`, `FROM_BASE64`, `X'…'`. Frontend passes types.                                                                   |
| 13  | med  | SQLite attached-schema PRAGMA syntax                                                      | `PRAGMA "schema".table_info(...)` form for all four pragmas.                                                                                                                                            |
| 14  | med  | SSE chunks decoded per chunk (UTF-8 splits)                                               | Byte buffer, decode per line.                                                                                                                                                                           |
| 15  | med  | Malformed tool JSON → `{}`; EOF accepted                                                  | Invalid arguments are an error; require `message_stop` / `finish_reason` / `[DONE]`.                                                                                                                    |
| 16  | med  | CLI failure with partial text treated as success                                          | Structured failures and non-zero exits are errors.                                                                                                                                                      |
| 17  | med  | Postgres arrays with NULL elements failed to decode                                       | Decode as `Vec<Option<T>>`.                                                                                                                                                                             |
| 18  | med  | MySQL TIME via NaiveTime                                                                  | Decode with `MySqlTime`.                                                                                                                                                                                |
| 19  | med  | SQLite schema name interpolated unquoted                                                  | Uses `literal()`.                                                                                                                                                                                       |
| 20  | low  | MCP batch shape / id-less requests                                                        | Batch stays an array; notifications (no id) get no response; missing method → invalid request.                                                                                                          |
| 21  | low  | Negative money < 1 unit lost sign                                                         | Fixed formatting.                                                                                                                                                                                       |
| 22  | low  | SQL export identifiers unescaped                                                          | Quotes doubled.                                                                                                                                                                                         |

## 2026-10-10 — Frontend accessibility review #1 (Claude subagent, web-design-guidelines)

15 findings, all applied:
grid gets a selected cell on focus and exposes `aria-activedescendant`; cell editor returns focus to the grid; tab bar
supports Arrow/Home/End; sidebar tree items carry role/name/state on the focusable element with ArrowUp/Down navigation;
segmented controls use `aria-pressed` buttons instead of fake tablists; driver and colour pickers are native radios with
named colours; sortable headers are buttons; muted/NULL/warning tokens raised to ≥4.5:1; connection state and tool
outcome have text equivalents; approval card is an assertive live region with focus on the primary action; hit targets
≥24px with visible focus; Redis key list is a list of buttons; charts have an sr-only summary; markdown links are real
anchors opened through the OS.

## 2026-10-10 — Security scan (automated) — Redis command injection

Keys/values were interpolated into command-line strings in `RedisTab`. Added `redis_exec(args[])` which passes
arguments straight to `redis::cmd().arg()`; DEL/EXPIRE/PERSIST/SET now use it.

## 2026-10-10 — Visual QA pass (screenshots of every screen in mock mode)

Fixed: query tab infinite re-render (zustand selectors returning fresh arrays) that blanked the window; connection dialog
row baselines (hint under Group) and all form grids aligned to `items-start`; sidebar names no longer truncated by the
driver label (read-only badge instead); dashboard rows no longer double-indented; grid headers sized for name + type;
chat input no longer shows scroll arrows; SQL blocks in chat wrap; provider dropdown no longer cramps the session title;
pie charts cap at 7 slices + Other. Added per-tab error boundaries.

## 2026-10-10 — Frontend review #1 (Codex, `codex exec`, read-only sandbox)

13 findings (4 high, 9 medium), all addressed:

| #   | Sev  | Finding                                                    | Resolution                                                        |
| --- | ---- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | high | Table page requests could complete out of order            | Request generation counter; stale responses ignored               |
| 2   | high | Newly created chat session could be replaced by the loader | Created sessions are added to the list immediately                |
| 3   | high | Late session fetch could restore the wrong conversation    | Load sequence guard                                               |
| 4   | high | Switching sessions mid-turn kept busy/stream state         | Turn state keyed by session id; events apply to their own session |
| 5   | med  | Keyboard run bypassed the running guard                    | Synchronous in-flight ref + request id                            |
| 6   | med  | Inspector/anchor kept across result changes                | Reset on result change; bounds-checked                            |
| 7   | med  | Inspector showed original value after “Set NULL”           | `edits.has()` instead of `??`                                     |
| 8   | med  | Copy ignored pending edits                                 | Edits overlaid before serialising (selection and row menu)        |
| 9   | med  | Shift+Tab could select column −1                           | Clamped                                                           |
| 10  | med  | Untouched appended rows produced no INSERT                 | Tracked; backend emits `DEFAULT VALUES` / `() VALUES ()`          |
| 11  | med  | Prefill event lost when the panel was closed               | Prefill lives in the store (`askAssistant`)                       |
| 12  | med  | Mongo collections fetched during render                    | Fetch in an effect with per-db loading state                      |
| 13  | med  | Deleting an open dashboard left no active tab              | Uses `closeTab`                                                   |

## 2026-10-10 — Field bug: connect stuck on “connecting”

`keyring` (async-secret-service via zbus) blocks on its own runtime; calling it inside an async Tauri command panicked the
tokio worker (“Cannot start a runtime from within a runtime”), so `connect` never returned. All keychain calls now run on a
plain thread (`off_runtime` in config.rs). Added an ignored latency test (`cargo test --lib keyring_latency -- --ignored`).

## 2026-10-11 — M8 query versions / portable profiles (Codex, `codex exec review --uncommitted`)

Round 1: 1 finding, addressed. Round 2 (after the panel fixes below): no findings.

| #   | Sev | Finding                                                                                                         | Resolution                                                                                           |
| --- | --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | P2  | `stripUrlPassword` treated an `@` inside the query string as the userinfo separator (`…?appName=a@b` corrupted) | Authority bounded at the first `/`, `?` or `#` before looking for userinfo; cases added to the check |

Reviewer panel (correctness / security / requirements / skeptic, read-only agents on the same diff), 0 blockers:

| #   | Sev  | Finding                                                                                    | Resolution                                                                                                            |
| --- | ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | high | A `.sql` written with a UTF-8 BOM loads invisibly broken; UTF-16 surfaces a raw io error   | BOM stripped on read; non-UTF-8 mapped to a plain message                                                             |
| 2   | med  | Import saved profiles one by one; a bad entry mid-file left earlier ones imported silently | All entries validated before any save (port, ssh shape); toast reports "imported N of M"; list refreshed in `finally` |
| 3   | med  | Imported `color` is rendered as inline CSS                                                 | Only hex colours accepted                                                                                             |
| 4   | med  | `read_text_file` / `write_text_file` take any path the webview sends                       | Kept (same shape as `export_rows`, first-party webview); `ponytail:` comment names the dialog-gated allowlist upgrade |
| 5   | low  | Sync file commands ran on the main thread                                                  | Made `async` like `export_rows`                                                                                       |
| 6   | low  | "Open .sql file…" replaced unsaved editor text                                             | Opens in a new tab when the editor is non-empty                                                                       |
| 7   | low  | Saving a file-bound tab as a named query dropped the file binding                          | Bindings are independent; Mod+S prefers the file                                                                      |
| 8   | low  | Version logic had no runnable check                                                        | Extracted to `src/lib/queries.ts` with `queries.check.ts` in `pnpm check`                                             |
| 9   | low  | Mod+S outside the editor falls through to the webview default; `write` is not tmp+rename   | Skipped: pre-existing behaviour, same as `export_rows`                                                                |

CodeRabbit on PR #6, round 1: 10 comments, all addressed (table below). Codex round 3 on those fixes: 3 findings,
addressed: unique per-save temp file name (pid + nanos, removed on a failed rename); destination permissions copied
onto the temp file before the rename; `saveQuery` rolls back its optimistic state when `kvSet` rejects, unless a
newer save already landed. Codex round 4: 2 findings on the same write path, addressed: the destination symlink is
resolved first so the target gets the text; the temp file is created `create_new` with mode 0600 (Unix) before any
bytes are written, then takes the destination's mode and is removed on any failure. Codex round 5: 1 finding
skipped (a dangling symlink picked in the save dialog would be replaced by a regular file; not a realistic flow for
`.sql` files chosen in a native dialog, and the ceiling is noted in the function's comment).

| #   | Sev   | Finding                                                                           | Resolution                                                                                                                       |
| --- | ----- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | major | File commands did blocking fs work on the async runtime                           | Both run through `spawn_blocking`                                                                                                |
| 2   | major | Saving over an existing `.sql` truncated it before writing                        | Write `<path>.tmp` then rename                                                                                                   |
| 3   | major | Mongo `authMechanismProperties=AWS_SESSION_TOKEN:…` survived in exported URLs     | `stripUrlSecrets` drops credential-bearing query params (password/pwd/token/secret/authMechanismProperties) on export and import |
| 4   | major | Two tabs saving the same query could lose a version (state set after `kvSet`)     | State updated synchronously first, then persisted                                                                                |
| 5   | minor | Dialog rejections in QueryTab / Sidebar escaped the `try`                         | Dialog calls moved inside the `try` blocks                                                                                       |
| 6   | minor | `refreshConnections` failure in `finally` rejected the import handler silently    | Caught and toasted                                                                                                               |
| 7   | minor | Mod+S only worked with editor focus; `cbs.current` written during render          | Shortcut moved to the global handler in App.tsx (dispatches `agentql:save` to the active query tab); SqlEditor change reverted   |
| 8   | minor | Versions dialog said "Save keeps it" but Mod+S saves the file in a file-bound tab | Text now points at Saved › Save                                                                                                  |

CodeRabbit on PR #6, round 2: 0 new comments; one follow-up on the `saveQuery` rollback (two overlapping failed
saves could leave an unpersisted list in the store). Addressed: saved-query writes (save and delete) now go
through one promise queue in `src/lib/store.ts`, each starting from the state the previous write left and rolling
back to the last persisted list on failure.

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
