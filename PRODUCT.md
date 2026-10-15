# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Tauri 2 desktop shell rendering a React web UI on Linux, macOS and Windows; the design language is web, not per-OS native. -->

## Users

- **Developers and data engineers** who keep a SQL client open all day: browsing tables, writing and tuning queries, editing rows, inspecting schemas. Many come from TablePlus, DBeaver, DataGrip or Beekeeper. They work keyboard-first in long sessions.
- **Analysts and less-technical teammates** who mostly use the assistant and dashboards: they ask questions in plain language, read the result or chart, and pin it to a dashboard. Because they often cannot validate generated SQL themselves, the agent's steps and any writes have to be legible to them.

## Product Purpose

AgentQL is a cross-platform desktop database client (PostgreSQL, MySQL, MariaDB, SQLite, Redis, MongoDB) with an agent built in. The agent reads the schema, runs queries, optimises SQL, draws charts and proposes dashboards. It uses the user's own Claude or OpenAI key, or an existing Claude Code / Codex subscription. Success means the app is fast, works on any OS, and lets users trust the agent with real databases.

## Positioning

Few clients are fast, native, Linux-first, multi-engine and fairly licensed all at once. AgentQL adds AI that is held in check by the database itself: agent reads run in READ ONLY transactions (or `PRAGMA query_only`), every write stops on an approval card that shows the exact statement, and every step the agent takes is visible.

## Operating Context

- Connections to local, staging and production databases, by host/credentials or URL, with SSL and SSH tunnels. Secrets live in the OS keychain. Connections carry environment badges.
- Core surfaces: sidebar connection/schema tree, tabbed workspace (query editor, table browser, structure, ER diagram, schema diff, Redis, Mongo, dashboards), result grid, assistant chat panel, status bar, settings, connection dialog.
- A browser mock with a neutral demo dataset (`src/lib/mock*.ts`) drives the README walkthrough and screenshots.

## Capabilities and Constraints

- Tauri 2 + Rust backend; React 19, Tailwind v4, Radix UI, CodeMirror 6, recharts.
- Themes are CSS custom properties per `data-theme` in `src/index.css`. `pnpm check` (src/lib/themes.check.ts) enforces WCAG AA for fg/bg and accent-fg/accent.
- Open decisions (not confirmed in init): whether the 10 bundled editor themes stay, the target density, and whether to bundle webfonts or keep system fonts.

## Brand Commitments

- Name **AgentQL** and the logo/icon in `assets/brand/` (logo.svg, logo-dark.svg, icon.svg, icon-1024.png) are binding.

## Evidence on Hand

- Product walkthrough GIF and stills: `assets/demo/` (showcase.gif, grid, erd, query, agent-chart, agent-approval, dashboard).
- User research: `docs/USER-RESEARCH.md`, sourced from HN, GitHub issues and dev.to; Reddit is absent.
- There are no testimonials, customer logos or benchmarks. Do not invent any.

## Product Principles

1. **Speed is the feature.** It should launch instantly and show the tables; nothing gets in front of the data.
2. **Safety is shown, not promised.** Read-only enforcement, approvals and environment (prod vs dev) stay visible at the point of action.
3. **The agent shows its work.** Tool calls, SQL and results stay inspectable so people who can't read SQL can still follow and trust it.
4. **One tool, many engines.** Engine differences show up only where they matter.

## Accessibility & Inclusion

- Every theme must pass WCAG AA contrast (CI-enforced). Every function must be reachable from the keyboard.
