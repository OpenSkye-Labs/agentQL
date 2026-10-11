# Review log — PR #13: agent scope fails closed

Follow-up to M2 (PR #9). Each round: reviewer, findings, resolution. Raw Codex output under `.agent/` (git-ignored).

## 2026-10-11 — Codex round 1 (`codex exec review --uncommitted`)

Scope: the collector (`SqlRefs.unsupported`, `TABLE` bodies, `LATERAL` factors, exhaustive matches), `static_scope_check`,
the `SET LOCAL search_path` pin and the unqualified-name refusal on MySQL/SQLite.

No actionable findings. Codex ran the library tests itself (7 passed, 1 ignored) and noted that the database-backed
behaviour (the `SET LOCAL` pin) is not integration-tested; the `live` suite needs Docker and stays `--ignored`.
