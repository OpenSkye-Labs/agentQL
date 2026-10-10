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
