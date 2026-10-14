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
- Frontend shipped: connection manager (fields/URL, SSL, SSH agent/key/password, colour, groups, test), sidebar schema tree with filter,
  tabs (query/table/redis/mongo/dashboard), CodeMirror SQL editor with schema completion and run-at-cursor, virtualised grid with
  keyboard navigation, cell inspector, copy TSV/JSON, inline editing → reviewable SQL, filter/sort/paging, structure + DDL view,
  CSV/JSON/SQL export, query history and saved queries, Redis key browser + console, Mongo find/aggregate/edit, chat panel with
  streaming, tool cards, write approvals, chart cards, dashboard proposals, saved dashboards with auto-refresh.
- Live smoke tests (`cargo test --test live -- --ignored`) pass for all six drivers against Docker containers.
- Visual QA mode: `pnpm dev` then open `http://localhost:1420/?mock=1` to run the whole UI in a browser against in-page sample
  data (src/lib/mock.ts, dev builds only). Used to screenshot every screen and fix alignment issues.
- Per-tab error boundaries: a crash inside one tab or the assistant panel shows an inline error with "Try again" instead of a blank window.
- Performance pass: WebKitGTK DMA-BUF renderer (and compositing under WSL) disabled by default on Linux (`AGENTQL_GPU=1` opts
  back in); one shared context menu for the grid and for the sidebar tree instead of a Radix menu per cell/row; no backdrop
  blur; table pages render before COUNT(*) (count streams in afterwards, estimate shown meanwhile).
- Assistant UI redesigned around an agent activity timeline: each turn shows "Working… / Worked for 8 s · 3 steps" with
  expandable steps (query text, row counts, result grids), charts and dashboard proposals surface as results, suggestion
  chips on the empty state, and a composer with the provider picker and read-only/writes toggle built in.
- Public repo at github.com/OpenSkye-Labs/agentQL. GitHub Actions: `ci.yml` runs typecheck + cargo check/test on every push and PR;
  `release.yml` builds macOS (arm64 + x64), Linux (.deb/.AppImage/.rpm) and Windows (.msi/.exe) via tauri-action on any `v*` tag and
  publishes them as a draft GitHub Release. Cut a release with `git tag vX.Y.Z && git push origin vX.Y.Z`, then publish the draft.
- Open-source workflow: `main` is protected by a ruleset (PR + code-owner review + `ci-ok` status, squash-only, admins bypass).
  CI runs oxfmt/oxlint/tsc/build for frontend changes and rustfmt/clippy/test for Rust changes, filtered by touched paths,
  plus a version-consistency check (`pnpm version:check`). CONTRIBUTING.md, PR template, CODEOWNERS, Dependabot for actions,
  and all actions pinned to commit SHAs. Codebase formatted once with `cargo fmt` and `oxfmt`.
- Automated versioning with release-please: conventional-commit PR titles drive the bump; on every merge to `main` a release PR
  bumps package.json / tauri.conf.json / Cargo.toml and CHANGELOG.md; merging it tags `vX.Y.Z`, creates the GitHub Release and
  dispatches the installer build. `dev` -> `main` PRs use a merge commit so individual commit titles survive.
- Updater signing keys generated (`~/.tauri/agentql.key` + `.password` on the maintainer machine, backed up out of band).
  Private key and password live in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
  the public key and `createUpdaterArtifacts` are in `src-tauri/tauri.release.conf.json`, merged only by the release workflow
  so local builds need no key. Release assets include `.sig` files and `latest.json` for the updater plugin.
- In-app updater (`tauri-plugin-updater`): the status bar checks `releases/latest/download/latest.json` once at startup and shows
  an "Update to vX.Y.Z" button that downloads, verifies the minisign signature against the pubkey in tauri.conf.json, installs and restarts.
- Licensed under MIT (LICENSE, package.json, Cargo.toml). README gained the SignPath-required "Code signing policy" and
  "Privacy policy" sections plus a License section; SECURITY.md documents private vulnerability reporting.
- Brand: new app icon and logo ("talking database": cylinder with a chat tail and an amber band). Source of truth is
  `assets/brand/icon.svg` / `logo.svg` / `logo-dark.svg`; platform icons regenerated with `pnpm tauri icon assets/brand/icon.svg`.
  README header uses the SVG lockup with a light/dark swap; `assets/brand/social-1080.png` is for social avatars and the GitHub social preview.
- Update dialogs: when a newer release is found the status bar button opens "Update available" with the release notes and
  Later / Update now; after an update installs, "What's new in vX.Y.Z" shows that version's section of the bundled CHANGELOG.md once.
- Windows build fix: ssh-agent auth uses the OpenSSH agent named pipe on Windows (russh `connect_named_pipe`); CI now runs
  `cargo check` on Windows and macOS for Rust changes so cross-platform compile errors fail the PR, not the release build.

## 2026-10-11

- Editor ergonomics (M7): a `schema_catalog` command fetches every column and foreign key of a schema in one round
  trip (per-table pragmas on SQLite), loaded next to the sidebar's table list. With columns in the namespace,
  `@codemirror/lang-sql` resolves `FROM orders o` so `o.` lists the `orders` columns. `src/lib/completion.ts` adds JOIN
  suggestions from forward and reverse foreign keys (`customers c ON c.id = o.customer_id`), keywords ranked by the
  current clause, and saved-query snippets offered by trigger word; checklist in docs/TESTING.md, self-check in
  `pnpm check`.
- Vim keymap toggle (`@replit/codemirror-vim`) in Settings → General, persisted as `editor_vim`; keyboard shortcut
  reference dialog on `Mod+Shift+/` (Mod+/ stays CodeMirror's comment toggle) and from the query toolbar.
- Snippets: saved queries may contain CodeMirror placeholders (`${1:table}`); loading one from the Saved menu or
  accepting its trigger in completion walks the placeholders with Tab. The save dialog replaces `window.prompt` and
  takes an optional trigger word. Key rebinding stays out (roadmap "Out").
- M8 Query versioning and portable profiles: a query tab remembers the saved query it was loaded from, so "Save"
  updates it and keeps the previous text as a version (last 20, with timestamps; "Versions…" dialog restores one into
  the editor). Sidebar "…" menu exports all connection profiles to JSON without any secret (ids dropped, URL
  passwords stripped; `src/lib/profiles.ts`) and imports such a file as new connections that still need their
  passwords entered. "File" menu in the query tab opens/saves `.sql` files (`Mod+S`); the path shows next to the
  toolbar and as the tab tooltip. Backend: `read_text_file` (20 MB cap) / `write_text_file` commands.
- Safety defaults (M1): `Cmd/Ctrl+Shift+Enter` / "Run all" asks for confirmation when the script holds more than one
  statement (count shown); `Cmd/Ctrl+Enter` still runs only the statement under the cursor. Connections carry an optional
  **environment** tag (`dev` / `staging` / `production`) set in the connection dialog and shown as a badge in the tab bar and
  status bar. On `production`, every write from the editor is confirmed with the statement kind and target table
  (`classify_sql`, backed by the same sqlparser classifier as read-only mode; unparseable scripts fail closed), and grid
  edits always go through the SQL preview. The preview and the pending-changes bar say the batch runs in one transaction.
  Known limits: the prompt is SQL-only (Redis/Mongo connections get the badge but no write prompt yet, tracked in TASKS.md),
  and side effects hidden in functions (`SELECT setval(...)`, `pg_terminate_backend`) are invisible to a static classifier.
- Engineering rules distilled from 39 CodeRabbit findings across PRs #4-#10 added to CLAUDE.md and to `.coderabbit.yaml`
  path instructions; ADRs started in `docs/adr/` (branching + releases, vector brand assets, per-PR review logs).
- AI trust and audit (M2): first-use consent card per connection before a remote API provider (Anthropic/OpenAI/compatible
  with a non-localhost base URL) receives any schema or data, stored as `agent_remote_consent_at` on the connection and
  revocable in the connection dialog; CLI providers and localhost base URLs skip it. Per-connection agent scope (`agent_scope`,
  whole schemas or single tables, picked from the "Scope" pill in the assistant) is enforced in the tool layer: list/describe
  tools filter or refuse, and run_sql / explain_sql / charts parse the SQL with sqlparser to check every referenced table
  (unparsable SQL is refused while a scope is set). Every statement the agent executes lands in the normal query history
  tagged `source: "agent"` with its session id (backend writes `history.json` under a lock; the UI appends through the same
  command). run_sql pushes `LIMIT <limit>` into bare SELECTs that have no LIMIT/OFFSET/FETCH/lock clause so the database
  stops scanning early.
- Agent scope fails closed (follow-up to M2): `TABLE x` bodies, `LATERAL fn(...)` factors and every table factor the
  parser-side collector does not model (PIVOT, JSON_TABLE, ...) are refused while a scope is set, as is `set_config()`.
  On Postgres the resolved schema for unqualified names is pinned at execution with `SET LOCAL search_path` inside the
  statement's transaction (run_sql, explain_sql, charts); on MySQL/SQLite scoped SQL must schema-qualify table names.
- Foreign-key click-through (M4): in a table tab, cells of FK columns show a jump arrow on hover (and an "Open referenced
  row in …" context-menu item) that opens the referenced table filtered to that key (`"id" = …`). The filter now lives on
  the tab, so jumping into an already open table re-targets it; tabs with pending edits ask before discarding them.
  SQLite FKs declared without a target column list resolve to the parent's primary key.
- ER diagram (M4): "ER diagram" on a schema's context menu opens a tab that introspects every table (`schema_objects`),
  lays them out with dagre (left-to-right ranks) and draws them as plain SVG: PK columns highlighted, FK columns marked,
  edges from the FK column to the referenced table. Wheel zooms around the cursor, drag pans, hovering a table lights up
  its relations, clicking opens the table tab. Export writes SVG (theme colours inlined) or PNG (2x) via the save dialog.
- Schema diff (M4): "Schema diff…" on a connection (or "Compare schema…" on a schema) opens a tab with two
  (connection, schema) pickers over the connected SQL databases. Compare introspects both sides, matches objects by name,
  lists them as added / removed / changed / unchanged and shows a line diff of the DDL (schema qualification and MySQL
  AUTO_INCREMENT counters normalised away). "Copy as migration" writes SQL that moves A towards B: CREATE TABLE
  synthesised from the metadata, drop statements for tables, views and materialized views, ADD / DROP COLUMN, and
  review comments for type changes, indexes, foreign keys and views. Two databases on one Postgres server need two
  connections.
- ADR-0003 applied: per-PR review logs under `docs/reviews/`, REVIEWS.md keeps pre-PR history plus an index.
- Codex CLI provider: `exec resume` no longer fails on `--sandbox` (sandbox set via `-c sandbox_mode`), and
  `approval_policy=never` stops non-interactive Codex from auto-denying the MCP database tools.
- Themes: "Follow system" asks the backend for the OS preference (gsettings on GNOME, the registry under WSL) because
  WebKitGTK's `prefers-color-scheme` only follows the GTK theme. Named themes (GitHub light/dark, Solarized light/dark,
  Nord, Dracula, One Dark) are token blocks in `index.css`; `pnpm check` verifies tokens and WCAG AA contrast.
- Primary buttons use the theme's `--accent-fg` again: an unlayered `button { color: inherit }` reset in index.css was out-ranking every Tailwind `text-*` utility.
- Connecting to `localhost` on Windows no longer stalls: the IPv4 loopback is preferred when the name resolves to both (skipped under verify-full).
- README showcase: 33 s walkthrough GIF plus seven feature stills recorded on the neutral demo dataset (`assets/demo/`), and a "How agentic is it?" section.
- Browser mock (`?mock=1`) is a neutral demo: a fictional `shop` store (Postgres, Redis, Mongo) with seeded rows, real foreign keys and a "Sales overview" dashboard; chat prompts play scripted agent runs (revenue chart, top customers, write approval, fallback) through real `ai:event`s.
- Cell inspector is a CodeMirror viewer/editor (`ValueEditor`): JSON columns get syntax colours, per-level folding,
  fold/unfold-all, Ctrl+F search, a Format button and a parse check on Save; Edit widens the panel and a maximize
  toggle takes the whole grid area instead of handing the value to the single-line in-cell input.
  Every fifth demo order carries a deep `shipping_address` payload so the mock shows large JSON.
