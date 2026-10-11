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
