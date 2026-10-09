# Feature log

Append-only record of shipped behaviour. Newest at the bottom.

## 2026-10-10
- Project scaffolded: Tauri 2, React 19, TS, Tailwind v4, Vite 7. Rust 2024 edition.
- Connection model supports six drivers (postgres, mysql, mariadb, sqlite, redis, mongodb), discrete fields or URL,
  SSL modes with CA/cert/key paths, SSH tunnel (agent / password / key file), read-only flag, colour, group.
- Secrets stored in OS keychain under service `com.aindong.agentql`; plaintext fallback file when unavailable.
- SQL execution returns one result per statement, with row limit + truncation flag and per-statement duration.
- Table editing produces reviewable SQL (UPDATE/INSERT/DELETE keyed by primary key values) executed in one transaction.
