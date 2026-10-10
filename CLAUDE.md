# AgentQL

Cross-platform desktop database client (Tauri 2 + Rust backend, React 19 + TypeScript frontend),
inspired by TablePlus / DBeaver / Navicat, with an agentic AI layer that can chat with data,
write and optimise SQL, and build dashboards.

## Stack

- **Backend**: Rust 2024, Tauri 2, sqlx 0.8 (postgres, mysql/mariadb, sqlite), redis 0.27, mongodb 3,
  russh (SSH tunnels), keyring (OS keychain, file fallback), reqwest (LLM APIs), axum (in-process MCP server).
- **Frontend**: Vite 7, React 19, TypeScript, Tailwind v4, Radix UI (`radix-ui`), CodeMirror 6,
  @tanstack/react-virtual, react-resizable-panels, recharts, zustand, lucide-react.
- Package manager: `pnpm`. Rust via `cargo` (run from `src-tauri/`).

## Commands

```bash
pnpm install                 # frontend deps
pnpm tauri dev               # run the desktop app (vite + cargo)
pnpm typecheck               # tsc --noEmit
cd src-tauri && cargo check  # Rust type-check
cd src-tauri && cargo test   # Rust unit tests
pnpm tauri build             # release bundles
```

## Layout

```
src-tauri/src/
  lib.rs          Tauri builder, managed state, command registration
  commands.rs     #[tauri::command] handlers (thin; delegate to modules)
  config.rs       ConnectionConfig / Settings / Store (JSON files + keychain secrets)
  ssh.rs          russh local port-forward tunnel
  db/             mod.rs (types + Manager), sql.rs (sqlx), value.rs (row->JSON), redis.rs, mongo.rs
  ai/             mod.rs (sessions, tool loop, events), providers.rs (anthropic/openai/claude-cli/codex-cli), tools.rs
  mcp.rs          axum streamable-HTTP MCP endpoint so Claude Code / Codex CLIs can use the app's DB tools
src/
  lib/            tauri invoke wrappers + types (api.ts), stores (zustand)
  components/     UI (sidebar, editor, grid, chat, dashboards, connection dialog, ...)
docs/             PLAN.md, ARCHITECTURE.md, TASKS.md, FEATURES.md, REVIEWS.md
```

## Conventions

- Rust commands return `Result<T, AppError>`; `AppError` serialises to a plain string for the UI.
- Query results are driver-agnostic `QueryResult { columns, rows: Vec<Vec<serde_json::Value>> }`.
- Binary values are encoded as `{ "$bytes": base64, "len": n }`.
- Secrets never go into `connections.json`; they live in the keychain (or `secrets.local.json` fallback).
- Agent tool calls that write go through an in-app approval (`agent_allow_writes` setting + per-call approval).
- Deliberate simplifications are marked with a `ponytail:` comment naming the ceiling and the upgrade path.
- Every feature or decision is recorded in `docs/` (TASKS.md board, FEATURES.md log). Keep them current.
- Code is reviewed with Codex (`codex exec review --uncommitted`); findings and fixes go to `docs/REVIEWS.md`.

## Workflow

- `main` is protected: no direct pushes, squash-merge only, needs a green `ci-ok` check and a code-owner review.
  Work on a branch (`feat/...`, `fix/...`, or the maintainer's `dev`), push, open a PR. See CONTRIBUTING.md.
- Frontend quality gates: `pnpm format:check` (oxfmt), `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm check`, `pnpm build`.
  Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. CI runs only the stack you touched.
- Version lives in package.json, tauri.conf.json and Cargo.toml; change it with `pnpm version:set X.Y.Z`.
  Releases are cut by pushing a `vX.Y.Z` tag, which builds installers into a draft GitHub Release.
- Commits and PRs carry no AI co-author or "generated with" trailers.
