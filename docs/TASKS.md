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
- [ ] Tauri commands + state wiring (`commands.rs`, `lib.rs`)
- [ ] `cargo check` clean, unit tests pass

## Phase 2 — AI backend
- [ ] Session model + persistence
- [ ] Anthropic Messages streaming provider with tool use
- [ ] OpenAI-compatible chat completions streaming provider with tools
- [ ] Claude Code CLI provider (stream-json, resume, MCP)
- [ ] Codex CLI provider (--json, resume, MCP)
- [ ] Tool set (schema, run_sql, explain, charts, dashboard proposal, redis, mongo)
- [ ] Write approval flow
- [ ] In-process MCP endpoint (axum)

## Phase 3 — Frontend shell
- [ ] App shell, theming tokens, layout with resizable panels
- [ ] Connection manager dialog (all drivers, SSH, SSL, URL mode, test connection)
- [ ] Sidebar schema tree with search
- [ ] Tab system (query, table, chat, dashboard, redis, mongo)
- [ ] SQL editor (CodeMirror 6, schema-aware autocomplete, run selection, Cmd/Ctrl+Enter)
- [ ] Virtualised result grid, cell inspector, copy, export
- [ ] Table browser: paging, filter, sort, inline edit, pending changes preview, structure tab
- [ ] Redis browser · Mongo browser
- [ ] Query history + saved queries

## Phase 4 — AI frontend
- [ ] Provider settings (API keys, CLI detection, model list)
- [ ] Chat panel: streaming, tool cards, approval dialog, insert SQL into editor
- [ ] Charts in chat, dashboards page (grid of charts, refresh, save)
- [ ] "Optimise this query" / "Explain" actions from editor

## Phase 5 — Polish
- [ ] Accessibility pass (focus order, ARIA, keyboard shortcuts, reduced motion, contrast)
- [ ] Codex review of backend and frontend; fixes logged in REVIEWS.md
- [ ] README with screenshots-free quick start
