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

## Engineering rules (distilled from review findings, see docs/adr/)

- **Async results can be stale.** Any effect or store action that awaits (`invoke`, fetch, dialog) must snapshot
  what it depends on (tab id, editor text, a `seq` counter) and bail if that changed when the result arrives.
  Never put side effects inside a `setState` updater; persist from an effect after the state commits.
- **Every failure path does something.** `invoke`, native dialogs, clipboard and file I/O all reject; handle it
  with a toast or a visible state, and never show a success toast before the operation succeeded.
- **Never destroy data on a failed write.** Write to a temp file and rename; a config/history file that fails to
  parse is renamed to `*.corrupt`, not wiped. Confirm before any action that discards pending edits.
- **Blocking I/O never runs on the tokio runtime.** File, keychain and child-process work in commands goes
  through `tauri::async_runtime::spawn_blocking` (the keychain hang and the file-save review were both this).
- **SQL text is parsed, not substring-matched.** Comments and quotes change meaning: `--` or `/*` inside a quoted
  value is data; a statement ending in a `--` comment cannot be joined with `;\n`; use the tokenizer.
- **Dialects differ in DDL.** SQLite has no `ADD CONSTRAINT`, `ADD COLUMN ... NOT NULL` needs a default, MySQL
  `GROUP_CONCAT` truncates at `group_concat_max_len`. Generated SQL is tested per driver.
- **Limits signal truncation.** When capping results, fetch `limit + 1` so the UI can say "truncated" instead of
  silently showing a full-looking page.
- **Secrets are stripped by type, not by field list.** Anything serialised outside the keychain goes through a
  dedicated public type so a new secret field cannot leak by omission.
- **Shared logs are append-only and conflict-prone.** Review logs live one file per PR under `docs/reviews/`
  (ADR-0003); FEATURES.md and TASKS.md entries stay short and are merged, never rewritten.

## Workflow

- `dev` is the default/integration branch; `main` is the release branch and only moves by PR from `dev`.
  Both are protected: no direct pushes, squash-merge only, green `ci-ok` check and a code-owner review.
  Work on a branch off `dev` (`feat/...`, `fix/...`), push, open a PR against `dev`. See CONTRIBUTING.md.
- Frontend quality gates: `pnpm format:check` (oxfmt), `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm check`, `pnpm build`.
  Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. CI runs only the stack you touched.
- Versioning is automated by release-please from conventional-commit PR titles (`feat:` minor, `fix:` patch).
  Feature PRs squash into `dev`; `dev` -> `main` uses a merge commit; release-please opens a release PR on `main`
  that bumps package.json / tauri.conf.json / Cargo.toml + CHANGELOG.md; merging it tags and builds the installers.
  Never bump versions by hand (`pnpm version:check` guards consistency in CI).
- Commits and PRs carry no AI co-author or "generated with" trailers.
