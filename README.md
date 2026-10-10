# AgentQL

[![CI](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml)
[![Release](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml/badge.svg)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/OpenSkye-Labs/agentQL?label=version&color=blue)](https://github.com/OpenSkye-Labs/agentQL/releases/latest)

A native, cross-platform database client with an agent built in. Think TablePlus / DBeaver, plus an assistant
that can read your schema, run queries, optimise SQL and build dashboards — using **your** Claude or OpenAI API
key, or your existing **Claude Code** / **Codex (ChatGPT)** subscription.

Built with Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) and React 19 + TypeScript.

## Databases

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

Connect with host/credentials or a URL, with SSL (require / verify-ca / verify-full, client certs) and through an
SSH tunnel (agent, key file, or password). Passwords live in the OS keychain.

## Highlights

- **Query editor** — CodeMirror with dialect-aware highlighting and schema completion. `Ctrl/⌘+Enter` runs the
  statement under the cursor; multi-statement scripts return one result per statement; EXPLAIN / EXPLAIN ANALYZE.
- **Grid** — virtualised, keyboard-navigable, cell inspector, copy as TSV/JSON, export CSV/JSON/SQL.
- **Table browser** — filter (WHERE), sort, paging, inline edits that become reviewable SQL applied in one
  transaction; structure view with indexes, foreign keys and DDL.
- **Redis** — SCAN-based key browser with typed viewers, TTL, and a console. **MongoDB** — find/aggregate, JSON or
  table view, edit/insert/delete documents, collection info.
- **Assistant** — streams answers, calls tools (schema, run_sql, explain, charts), asks for approval before any
  write, renders charts inline and proposes whole dashboards you can save and auto-refresh.
- **Safety** — read-only connections and agent reads are enforced _by the database_ (READ ONLY transactions /
  `PRAGMA query_only`), not just by parsing.

## Install

Download the installer for your platform from the [latest release](https://github.com/OpenSkye-Labs/agentQL/releases/latest):
macOS (Apple Silicon and Intel), Windows, and Linux (`.deb`, `.rpm`, `.AppImage`). The app checks for updates on
startup and installs them in place.

## Build from source

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux needs the usual Tauri prerequisites (webkit2gtk 4.1, gtk3, libssl). See `docs/TESTING.md` for throwaway
database containers and the live driver tests.

## AI providers

Settings → AI providers. Add one or more of:

- Anthropic API (key), OpenAI API (key), any OpenAI-compatible endpoint (Ollama, OpenRouter, Groq, …)
- Claude Code CLI or Codex CLI — uses the login you already have; the app exposes its database tools to the CLI
  over a local, token-protected MCP endpoint, so approvals and tool cards work the same way.

Agent writes are off by default; enabling them still requires a per-statement approval in the chat.

## Contributing

Pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers branches, checks, and how releases are cut.

## Docs

`CLAUDE.md` (repo guide) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
