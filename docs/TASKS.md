# Task board

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped

## Phase 1 — Backend core
- [x] Config types, JSON store, keychain secrets with file fallback (`config.rs`)
- [x] SSH tunnel (password / key file / agent) via russh (`ssh.rs`)
- [x] sqlx connections for Postgres / MySQL / MariaDB / SQLite incl. SSL options and URL mode
- [x] Dynamic row → JSON decoding for all three drivers (`db/value.rs`)
- [x] Statement splitter + read-only classifier (sqlparser with keyword fallback)
- [x] Introspection: databases, schemas, tables, columns, indexes, FKs, DDL
- [x] Table browse SQL builder, count, change → SQL generation, transactional batch
- [x] Redis: scan, typed key read, raw command, info
- [x] Mongo: databases, collections, find/aggregate, insert/replace/delete, collection info
- [x] Tauri commands + state wiring (`commands.rs`, `lib.rs`)
- [x] `cargo check` clean, unit tests pass
- [x] Codex review #1 → 22 fixes (see REVIEWS.md)

## Phase 2 — AI backend
- [x] Session model + persistence
- [x] Anthropic Messages streaming provider with tool use
- [x] OpenAI-compatible chat completions streaming provider with tools
- [x] Claude Code CLI provider (stream-json, resume, MCP)
- [x] Codex CLI provider (--json, resume, MCP)
- [x] Tool set (schema, run_sql, explain, charts, dashboard proposal, redis, mongo)
- [x] Write approval flow
- [x] In-process MCP endpoint (axum)

## Phase 3 — Frontend shell
- [x] App shell, theming tokens, layout with resizable panels
- [x] Connection manager dialog (all drivers, SSH, SSL, URL mode, test connection)
- [x] Sidebar schema tree with search
- [x] Tab system (query, table, chat, dashboard, redis, mongo)
- [x] SQL editor (CodeMirror 6, schema-aware autocomplete, run selection, Cmd/Ctrl+Enter)
- [x] Virtualised result grid, cell inspector, copy, export
- [x] Table browser: paging, filter, sort, inline edit, pending changes preview, structure tab
- [x] Redis browser · Mongo browser
- [x] Query history + saved queries

## Phase 4 — AI frontend
- [x] Provider settings (API keys, CLI detection, model list)
- [x] Chat panel: streaming, tool cards, approval dialog, insert SQL into editor
- [x] Charts in chat, dashboards page (grid of charts, refresh, save)
- [x] "Optimise this query" / "Explain" actions from editor

## Phase 5 — Polish
- [x] Live driver smoke tests against throwaway containers (docs/TESTING.md), all 7 passing
- [x] Accessibility pass (focus order, ARIA, keyboard shortcuts, reduced motion, contrast)
- [x] Codex review of backend (22 fixes) and frontend (13 fixes); accessibility review (15 fixes); visual QA pass — all logged in REVIEWS.md
- [x] README with quick start
