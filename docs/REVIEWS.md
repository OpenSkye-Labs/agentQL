# Review log

Each entry: date, scope, reviewer, findings, resolution. Raw Codex output is kept under `.agent/` (git-ignored).

## 2026-10-10 — Backend review #1 (Codex, `codex exec`, read-only sandbox)

Scope: all of `src-tauri/src` after the first backend commit (201189b). 22 findings (7 high, 12 medium, 3 low). All addressed:

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | high | `is_read_only` accepted every EXPLAIN / PRAGMA (EXPLAIN ANALYZE DELETE, PRAGMA x=1 wrote) | EXPLAIN is read-only unless ANALYZE wraps a write; PRAGMA with a value is a write. Tests added. |
| 2 | high | Parse failures fell back to first-keyword check | Fail closed: only bare `SHOW`/`DESCRIBE` pass when unparseable. |
| 3 | high | `SELECT nextval()` etc. treated as read-only | New `run_read_only` executes inside `SET TRANSACTION READ ONLY` / `START TRANSACTION READ ONLY` / `PRAGMA query_only`; used by agent reads, table browsing, charts, EXPLAIN, and read-only connections. |
| 4 | high | Table filter allowed `0; DELETE …` on SQLite | `validate_filter` requires one expression without `;`/comments, plus DB-enforced read-only execution. |
| 5 | high | Mongo aggregate/command ignored `read_only` | `$out/$merge` rejected; `run_command` limited to a read-command allowlist on read-only connections. |
| 6 | high | Chart sources / mongo writes skipped approval when writes allowed | Chart sources are always read-only; `$out/$merge` pipelines go through the approval flow. |
| 7 | high | SSH accepted any host key | Trust-on-first-use pinning in `ssh_known_hosts.json`; changed keys are rejected with a hint; `ssh_forget_host` command to reset. |
| 8 | med | Secret fallback file world-readable | Written with 0600 (dir 0700) on Unix. |
| 9 | med | Stale keychain value could shadow a fallback write; delete errors ignored | Fallback read first; `NoEntry` treated as successful delete. |
| 10 | med | URL passwords persisted in connections.json | `save_connection` strips the password into the secret store; drivers re-inject it at connect. |
| 11 | med | MySQL JSON literal backslash escaping | JSON values now go through the string literal path (backslashes escaped). NO_BACKSLASH_ESCAPES noted as a ceiling. |
| 12 | med | Postgres arrays/bytes always cast to `::jsonb` | `literal_typed` uses column type hints: Postgres array literals, `decode(…, 'base64')`, `FROM_BASE64`, `X'…'`. Frontend passes types. |
| 13 | med | SQLite attached-schema PRAGMA syntax | `PRAGMA "schema".table_info(...)` form for all four pragmas. |
| 14 | med | SSE chunks decoded per chunk (UTF-8 splits) | Byte buffer, decode per line. |
| 15 | med | Malformed tool JSON → `{}`; EOF accepted | Invalid arguments are an error; require `message_stop` / `finish_reason` / `[DONE]`. |
| 16 | med | CLI failure with partial text treated as success | Structured failures and non-zero exits are errors. |
| 17 | med | Postgres arrays with NULL elements failed to decode | Decode as `Vec<Option<T>>`. |
| 18 | med | MySQL TIME via NaiveTime | Decode with `MySqlTime`. |
| 19 | med | SQLite schema name interpolated unquoted | Uses `literal()`. |
| 20 | low | MCP batch shape / id-less requests | Batch stays an array; notifications (no id) get no response; missing method → invalid request. |
| 21 | low | Negative money < 1 unit lost sign | Fixed formatting. |
| 22 | low | SQL export identifiers unescaped | Quotes doubled. |

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
