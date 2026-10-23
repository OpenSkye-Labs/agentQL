# Streaming export (M5 part A)

Reviewed with the alleo-loop panel (correctness, requirements, maintainability, skeptic, security) plus a Codex
cross-check on `git diff dev...HEAD`. 0 blockers; findings applied unless noted.

Found by several reviewers independently:

- Cancel did not stop a Postgres/MySQL export promptly (skeptic's strongest objection, correctness, requirements,
  Codex): the stop flag was only checked between rows, and `rollback()` first makes sqlx read and discard every
  remaining row of the result. Applied: each row read races a `Stop` notify (`tokio::select!`), and the export runs on
  a connection detached from the pool that is dropped (socket closed) on cancel instead of rolled back. The server may
  keep executing until it next writes (`ponytail:`; `pg_cancel_backend` is the upgrade). Live tests
  `postgres_export_cancel` / `mysql_export_cancel` (cancel mid-result and during `pg_sleep`) were added but could not
  be run here: the local Docker daemon stopped answering. Run them with the containers in docs/TESTING.md.
- Fixed temp-file name opened with `File::create` (Codex, security, correctness, skeptic): a planted symlink at
  `.<name>.agentql-part` would be truncated, and two exports to one target corrupted each other. Applied: unique
  `.<name>.<uuid>.agentql-part`, opened with `create_new` (O_EXCL), with tests for both.

Security reviewer:

- SQL-format exports escaped only `'`, so on MySQL/MariaDB a stored `\'); DROP …` value closes the literal when the
  file is imported (pre-existing, now reachable for whole tables). Applied: backslashes are doubled when the source is
  MySQL/MariaDB (`export_rows` now takes the driver), with a test.

Correctness reviewer:

- The SQLite pool has one connection; a long export held it and stalled every other query on that database.
  Applied: SQLite exports open their own `read_only(true)` connection from the pool's options (which also drops the
  `query_only` on/off toggle).
- Cancel could be lost before the backend registered the job (frontend `classifySql`, connection lookup). Applied: the
  command registers the job first, and the hook remembers a Cancel and the query tab checks it after classifying.
- The integration test's cancel depended on a 250 ms progress tick. Applied: cancel before the first row,
  deterministically; it also asserts the job is unregistered afterwards.

Requirements reviewer:

- Progress stalled below ~1,000 rows/s: batches only went out when full. Applied: a partial batch goes out 250 ms
  after the previous one.
- `ponytail:` comments for the deliberate limits (fresh session on re-run, one read-only transaction held, server-side
  query after cancel, duplicated read-only setup) — applied. TESTING.md's "2,000 rows in flight" corrected to about
  3,000; TASKS.md no longer says "server-side cursor".

Skeptic, also applied: closing a tab mid-export now cancels it. Not changed: a re-run is a fresh session, so
`SET search_path` from earlier in a script does not carry over (same as running scripts today; noted as `ponytail:`).

Maintainability reviewer, applied: the misplaced `describe_columns` doc comment, `Batch` / `BATCH_ROWS` / `Stop` moved
into `db` (no `db` → `export` dependency), the stream macro returns `(rows, header_sent)` and uses `Option` for its
failure like `exec_stream!`, `From<csv::Error>` for `AppError`, the shared `blocking` helper, a typed `Format` the
commands deserialize (a typo is now an error, not a silent CSV), and one `ExportFormat` type in TypeScript. Not
applied: merging `stream_read_only`'s read-only setup with `run_one_opts` into one macro; left as a `ponytail:` so the
core query path is not refactored in this PR.

`ExportWriter`'s unit tests and the 200k-row integration test were written after the code, so they never ran red.
