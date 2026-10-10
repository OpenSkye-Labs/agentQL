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
- Update dialogs: when a newer release is found the status bar button opens "Update available" with the release notes and
  Later / Update now; after an update installs, "What's new in vX.Y.Z" shows that version's section of the bundled CHANGELOG.md once.
- Windows build fix: ssh-agent auth uses the OpenSSH agent named pipe on Windows (russh `connect_named_pipe`); CI now runs
  `cargo check` on Windows and macOS for Rust changes so cross-platform compile errors fail the PR, not the release build.
- Foreign-key click-through (M4): in a table tab, cells of FK columns show a jump arrow on hover (and an "Open referenced
  row in …" context-menu item) that opens the referenced table filtered to that key (`"id" = …`). The filter now lives on
  the tab, so jumping into an already open table re-targets it; tabs with pending edits ask before discarding them.
  SQLite FKs declared without a target column list resolve to the parent's primary key.
- ER diagram (M4): "ER diagram" on a schema's context menu opens a tab that introspects every table (`schema_objects`),
  lays them out with dagre (left-to-right ranks) and draws them as plain SVG: PK columns highlighted, FK columns marked,
  edges from the FK column to the referenced table. Wheel zooms around the cursor, drag pans, hovering a table lights up
  its relations, clicking opens the table tab. Export writes SVG (theme colours inlined) or PNG (2x) via the save dialog.
