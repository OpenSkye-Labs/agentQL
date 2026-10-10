# Plan

Goal: a polished, accessible, cross-platform SQL/NoSQL desktop client (TablePlus/DBeaver/Navicat class)
built with Tauri + Rust, with an agentic AI layer that uses the user's own LLM provider or subscription
(Claude API, Claude Code CLI subscription, OpenAI API, Codex CLI / ChatGPT subscription, any OpenAI-compatible
endpoint such as Ollama/OpenRouter/Groq) to chat with data, write/optimise SQL and build dashboards.

## Phases

| #   | Phase          | Scope                                                                                                                                                                   | Status |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | Scaffold       | Tauri 2 + React + TS + Tailwind, manifests, docs                                                                                                                        | done   |
| 1   | Backend core   | Config store + keychain, SSH tunnel, Postgres/MySQL/MariaDB/SQLite via sqlx, dynamic row decoding, introspection, table browse/edit SQL generation, Redis, MongoDB      | done   |
| 2   | AI backend     | Provider abstraction (Anthropic, OpenAI-compatible, Claude CLI, Codex CLI), tool loop, write approval, in-process MCP endpoint, chat persistence                        | done   |
| 3   | Frontend shell | Connection manager, sidebar schema tree, tabs, SQL editor (CodeMirror), virtualised result grid, table browser with inline edit + pending changes, Redis/Mongo browsers | done   |
| 4   | AI frontend    | Chat panel with streaming, tool-call cards, approvals, inline charts, "optimise query", dashboard builder + saved dashboards                                            | done   |
| 5   | Polish         | Accessibility pass (keyboard, ARIA, focus, reduced motion, contrast), themes, export CSV/JSON, saved queries, history, Codex review loop, docs                          | done   |

## Non-goals (for now)

- Schema designer / ER diagrams, data migration between servers, team sync. Add when asked.

## Key decisions

- **sqlx with per-driver dynamic decoding** instead of `Any` driver: keeps type fidelity (uuid, json, arrays, decimals).
- **russh** for SSH tunnels (password, key file, agent) instead of shelling out to `ssh`: works without a TTY on all OSes.
- **Keychain with file fallback**: WSL/headless Linux often has no Secret Service; the UI shows which storage is in use.
- **In-process MCP over streamable HTTP** for Claude Code / Codex CLI providers so subscription users get the same
  DB tools and the same write-approval UX as API-key users.
- **Edits generate SQL shown to the user** (TablePlus style) rather than opaque parameterised updates.
