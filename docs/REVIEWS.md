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
