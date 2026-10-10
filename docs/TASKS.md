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

## Phase 6 — Roadmap backlog (scoped in docs/ROADMAP.md, evidence in docs/USER-RESEARCH.md)

M1 Safety defaults (S)

- [ ] Run-all gets its own shortcut + confirmation when >1 statement
- [ ] Per-connection environment tag (dev/staging/production), shown in tab bar + status bar
- [ ] Writes on production connections require a confirmation naming statement kind + table

M2 AI trust and audit (M)

- [ ] First-use consent per connection before schema/data goes to a remote provider
- [ ] Per-connection scope picker (schemas/tables the agent may see)
- [ ] Agent-executed statements recorded in query history tagged `agent` with session id
- [ ] `run_sql` appends `LIMIT row_limit` to bare SELECTs

M3 Data dictionary (M)

- [ ] Table/column descriptions + named metrics stored with the connection
- [ ] Notes injected into the agent prompt and returned by `describe_table`
- [ ] Editing UI in structure tab + per-connection notes tab
- [ ] `save_note` tool with approval card

M4 Schema tools (M)

- [ ] Foreign-key click-through in the grid
- [ ] ER diagram per schema (auto-layout, pan/zoom, export SVG/PNG)
- [ ] Schema diff between two connections/databases, copy as migration

M5 Scale (M)

- [ ] 200k×60 benchmark fixture + grid fixes (horizontal virtualisation if needed)
- [ ] Streaming CSV/JSON/SQL export via server-side cursor with progress + cancel
- [ ] Streaming SQL dump import; CSV import with column mapping

M6 Connectivity (M)

- [ ] Kubernetes port-forward tunnel type
- [ ] AWS RDS/Aurora IAM token auth

M7 Editor ergonomics (S–M)

- [ ] Alias-aware completion, JOIN suggestions from FKs, completion checklist in TESTING.md
- [ ] Vim keymap toggle + shortcut reference dialog
- [ ] Snippets with placeholders

M8 Query versioning and portable profiles (S)

- [x] Saved query version history
- [x] Export/import connection profiles without secrets
- [x] Open/save .sql files from the editor

M9 Linux tier-1 and performance proof (S)

- [ ] Flatpak + AUR packaging in release workflow
- [ ] docs/PERFORMANCE.md with measured cold start / RSS / 100k-row render per platform
