# Architecture

```
┌──────────────────────── WebView (React) ────────────────────────┐
│ Sidebar (connections, schema tree) │ Tabs: Query / Table / Chat  │
│ Dashboards │ Redis browser │ Mongo browser │ Settings            │
└──────────────┬──────────────── invoke() / listen() ─────────────┘
               │ Tauri IPC
┌──────────────▼──────────────── Rust core ───────────────────────┐
│ commands.rs ──► db::Manager ──► SqlConn (sqlx pools)             │
│             │               ├► RedisConn (multiplexed)           │
│             │               └► MongoConn (mongodb::Client)       │
│             ├► config::Store (JSON + keychain)                   │
│             └► ai::Agent ──► providers (HTTP SSE / CLI procs)    │
│                        └──► tools.rs ──► db::Manager            │
│ mcp.rs (axum :random) ◄── claude / codex subprocess (MCP HTTP)   │
│ ssh.rs (russh tunnel) — rewrites host:port before connecting     │
└─────────────────────────────────────────────────────────────────┘
```

## Data flow: running a query

1. UI calls `run_query(connection_id, sql, limit)`.
2. `split_statements` splits the script (quotes, comments, `$tag$` aware).
3. Each statement streams via `fetch_many`; rows decode to JSON per driver (`db/value.rs`).
4. Zero-row SELECTs fall back to `describe` so headers still render.
5. UI renders a virtualised grid per result.

## Data flow: agent turn (API provider)

1. UI `ai_send(session_id, text)`; backend appends user message, builds system prompt with schema summary.
2. Provider streams; `text_delta` events go to the UI; tool_use blocks are collected.
3. Each tool runs in `ai/tools.rs`. Write SQL → `approval_request` event → UI dialog → `ai_resolve_approval`.
4. Tool results appended; loop until the model stops calling tools (max 25 iterations).
5. Session persisted to `chats/<id>.json`.

## Data flow: agent turn (CLI provider)

1. Backend spawns `claude -p ... --mcp-config {url}` or `codex exec --json -c mcp_servers.agentql.url=...`.
2. The CLI calls back into the app's MCP endpoint (`/mcp/<session_id>`, bearer token) for tools.
3. Tool execution and approval are identical to the API path; the UI shows the same cards.
4. Text output is parsed from the CLI's JSON stream; the CLI session id is stored for `--resume`.

## Persistence (app data dir)

- `connections.json`, `settings.json`, `dashboards.json`, `saved_queries.json`, `history.json`
- `chats/<session_id>.json`
- `secrets.local.json` only when no keychain is available.
