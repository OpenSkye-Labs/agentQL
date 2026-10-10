# Roadmap

Scoped from `docs/USER-RESEARCH.md` (2026-10-11). Milestones are ordered by evidence strength × effort; each lists
what is in, what is deliberately out, a size (S ≈ a day, M ≈ a week, L ≈ several weeks) and what it depends on.
Status lives on the task board in `docs/TASKS.md` (Phase 6+). Everything ships behind the normal PR flow into `dev`.

Already covered today, so not on the roadmap: fast native shell (Tauri), six engines, SSH tunnels, read-only
connections enforced by the database, agent reads inside READ ONLY transactions, per-statement write approval,
BYO key for Anthropic/OpenAI, Claude Code / Codex CLI subscriptions, local models through the OpenAI-compatible
provider (Ollama, LM Studio, llama.cpp all expose `/v1`), query → chart → dashboard, virtualised grid.

## M1 — Safety defaults for humans (S)

Evidence: research a5, Beekeeper #1679 (data loss from "run all"), pgen guardrails.

- In: `Cmd/Ctrl+Enter` runs the statement under the cursor only (keep); "run all" gets its own shortcut and, when the
  script has more than one statement, a confirmation listing how many will run.
- In: per-connection **environment tag** (`dev` / `staging` / `production`), shown in the tab bar and status bar;
  writes on `production` require a confirmation naming the statement kind and target table.
- In: grid edits and the "apply changes" flow already run in one transaction; surface that in the preview dialog.
- Out: forcing transactions on ad-hoc editor DML (surprising for users who manage their own BEGIN/COMMIT).
- Depends on: nothing.

## M2 — AI trust and audit (M)

Evidence: research d (fears: hallucinated schema, data leaving the machine, writes), DBeaver AI wiki, DataGrip 2026.2.

- In: **first-use consent** per connection before any schema or data is sent to a remote provider, stating what
  is sent (schema names, column names, query results the agent requests). CLI providers and local base URLs count
  as local and skip it.
- In: **scope picker** per connection: which schemas/tables the agent may see; default all, remembered.
- In: every agent-executed statement lands in the normal **query history** tagged `agent`, with session id, so
  the audit trail is the same place users already look.
- In: `run_sql` adds `LIMIT <row_limit>` to bare `SELECT`s without a limit (results are already truncated, this
  stops the database doing the full scan).
- Out: a raw request/response viewer (log to the session file instead; add a viewer if asked).
- Depends on: nothing. Pairs with M3 for the prompt content.

## M3 — Data dictionary the agent reads (M)

Evidence: research d + e6 ("can't understand the meaning of the data from column names"), every text-to-SQL
thread ends here. Differentiator: no desktop client has it.

- In: per-connection **notes**: markdown-ish descriptions for tables and columns, plus **named metrics**
  (`revenue = SUM(orders.total) WHERE status <> 'cancelled'`), stored next to the connection config, never in the DB.
- In: notes are injected into the agent's system prompt (scoped by M2) and returned by `describe_table`.
- In: editing UI in the table structure tab (inline "description" column) and a notes tab per connection.
- In: the agent can **propose** notes (`save_note` tool) and they go through the same approval card as writes.
- Out: syncing notes to database COMMENT ON (later, opt-in); team sharing (see M8).
- Depends on: M2 scope picker (so notes and scope use one model of "what the agent knows").

## M4 — Schema tools: FK jump, ER diagram, schema diff (M)

Evidence: research a6, a12, a14; CE-paywalled or missing in DBeaver/TablePlus/Beekeeper.

- In: **foreign-key click-through** in the grid: a cell whose column is an FK gets a jump affordance that opens the
  referenced table filtered to that key. S on its own; ship first.
- In: **ER diagram** per schema from the catalogue we already introspect; auto-layout (dagre or elk, one new dep),
  pan/zoom, click a table to open it. Export SVG/PNG.
- In: **schema diff** between two connections or two databases: DDL per object, textual diff, "copy as migration".
- Out: a visual schema designer / editing via the diagram.
- Depends on: nothing. Diagram and diff are independent, each M-sized.

## M5 — Scale: wide tables, big exports, dump import (M)

Evidence: research a7, a10, e3 (Beekeeper #752, DBeaver OOM issues).

- In: benchmark fixture (200k rows × 60 columns) in `docs/TESTING.md`; fix anything that drops below 60 fps
  scrolling or over 2 s to first paint. Horizontal virtualisation if column count forces it.
- In: **streaming export** (CSV/JSON/SQL) that pages through a server-side cursor and writes to disk in chunks,
  with progress and cancel; no full materialisation in memory.
- In: **import SQL dump** by streaming the file in statement batches with a progress bar; `.csv` import into an
  existing table with column mapping.
- Out: cross-database copy (table from Postgres to MySQL).
- Depends on: nothing.

## M6 — Connectivity beyond SSH (M)

Evidence: research a11, e2 (DBeaver #3270, #10862, #15242 all Enterprise-only; TablePlus #2007, #2952).

- In: **Kubernetes port-forward** as a tunnel type: pick context/namespace/service/port, spawn `kubectl port-forward`,
  same lifecycle as the SSH tunnel.
- In: **AWS RDS / Aurora IAM auth**: generate the token with sigv4 from the default credential chain and use it as
  the password; refresh on reconnect.
- Out: GCP Cloud SQL proxy and Azure AD (add when asked; same shape as the two above).
- Depends on: nothing.

## M7 — Editor ergonomics (S–M)

Evidence: research a4, a9 (TablePlus #1237 vim keys 65 👍, DataGrip loyalty is autocomplete).

- In: completion quality pass: alias-aware columns (`o.` lists `orders` columns), JOIN suggestions from FKs,
  keywords after context; measure against a checklist in `docs/TESTING.md`.
- In: **vim keymap** toggle (`@replit/codemirror-vim`, one dep) and a shortcut reference dialog.
- In: snippets with placeholders stored with saved queries.
- Out: a full keymap editor (expose the handful people remap: run, run all, format, new tab).
- Depends on: nothing.

## M8 — Query versioning and portable profiles (S)

Evidence: research a15 (TablePro #2505, Querya #1064, Beekeeper #256).

- In: saved queries keep a **version history** (last N edits with timestamps, restore).
- In: **export/import connection profiles** without secrets (JSON), for onboarding teammates.
- In: open/save `.sql` files from the editor tab, with the file path shown.
- Out: real-time collaboration, cloud sync.
- Depends on: nothing.

## M9 — Linux tier-1 and performance proof (S)

Evidence: research a1, a2, b (TablePlus #1056 Linux 54 👍; "if only it ran on Linux").

- In: Flatpak and AUR packaging in the release workflow alongside `.deb`/`.rpm`/`.AppImage`.
- In: a `docs/PERFORMANCE.md` with measured cold start, RSS with one connection, and 100k-row render on Linux,
  macOS and Windows, re-run per release and quoted in the README.
- Out: snap.
- Depends on: first release shipped.

## Not planned (and why)

- Vector / columnar engines (ClickHouse, DuckDB, BigQuery): real asks, but each is its own driver; revisit once the
  roadmap above lands and the SQL path is stable. DuckDB first if any.
- Visual query-plan viewer: rarely asked by users (research honourable mentions); `EXPLAIN` text + "explain this
  plan" in the assistant covers the need for now.
- Web/hosted version: Outerbase's shutdown is the cautionary tale; desktop-only keeps the privacy story simple.
