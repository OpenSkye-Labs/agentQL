# Feature log

Append-only record of shipped behaviour. Newest at the bottom.
A month moves to `docs/features/<yyyy-mm>.md` once this file nears the 20 KB commit limit.

Earlier entries: [October 2026](features/2026-10.md).

## 2026-11-14

- Bench mode (M9): `AGENTQL_BENCH`, `scripts/perf/bench-app.mjs` and the Perf workflow. docs/PERFORMANCE.md.
- Linux cold start on the Perf runner: 30.4 s → 987 ms. Start-up waited for a D-Bus session bus the runner lacked, not
  for the app; the bench reports `setup_ms` / `script_ms` to place such waits. READMEs quote the numbers.
- Keychain commands are async (off the main thread); every `connections.json` write goes through one locked
  `update_connections`. `commands.rs` split into `commands/{sql,nosql,app}.rs`.
