# Feature log

Append-only record of shipped behaviour. Newest at the bottom.

## 2026-10-10
- Project scaffolded: Tauri 2, React 19, TS, Tailwind v4, Vite 7. Rust 2024 edition.
- Connection model supports six drivers (postgres, mysql, mariadb, sqlite, redis, mongodb), discrete fields or URL,
  SSL modes with CA/cert/key paths, SSH tunnel (agent / password / key file), read-only flag, colour, group.
- Secrets stored in OS keychain under service `com.aindong.agentql`; plaintext fallback file when unavailable.
- SQL execution returns one result per statement, with row limit + truncation flag and per-statement duration.
- Table editing produces reviewable SQL (UPDATE/INSERT/DELETE keyed by primary key values) executed in one transaction.
- Read-only is enforced by the database, not just by parsing: reads from the agent, table browsing, charts and read-only connections run inside READ ONLY transactions (`PRAGMA query_only` on SQLite).
- SSH host keys are pinned on first use (`ssh_known_hosts.json`); a changed key blocks the connection until forgotten.
- Agent providers: Anthropic API, OpenAI API, OpenAI-compatible endpoints, Claude Code CLI and Codex CLI (both via an in-process MCP endpoint with bearer auth).
- Agent tools: list_schemas, list_tables, describe_table, run_sql (approval for writes), explain_sql, create_chart, propose_dashboard, redis_scan/redis_command, list_databases/list_collections/describe_collection/mongo_find/mongo_aggregate.
