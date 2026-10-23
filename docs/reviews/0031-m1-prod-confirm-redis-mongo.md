# Production prompt for Redis and Mongo writes (PR #31)

Reviewed with the alleo-loop panel (correctness, requirements, maintainability, skeptic) plus a Codex cross-check
(`codex exec --sandbox read-only` on `git diff dev...HEAD`). 0 blockers; every finding below was applied.

Codex: 1 finding, applied.

- P2: the Redis prompt cut the command at 200 characters without a marker, so `DEL <196-char key> critical-key`
  hid the second key it deletes — applied: `clipArgs` clips each argument separately with `… (N chars)`, so every
  target stays visible (checked in `production.check.ts`).

Skeptic: strongest objection applied.

- The `$out` / `$merge` prompt named the source collection, never the one written, though `$out` replaces its
  target (possibly in another database) — applied: `mongo_pipeline_write_target` returns `$out replaces db.coll` /
  `$merge into db.coll` (string, `{db, coll}` and `{into: …}` forms, tested against `pipeline_writes` so the two never
  disagree) and the prompt shows it.
- Runner-up: `plain()` missed C1 controls and U+2028/2029 — applied.

Requirements reviewer: 2 partial criteria.

- A failed pipeline check showed the raw IPC error in the result panel instead of a "not running on production"
  toast — applied.
- The Redis bullet is the command as typed (each argument clipped), not `<COMMAND> on key "<key>"` as the plan said.
  Kept deliberately: the full command shows every key and the value being set, which the plan's form would hide.
- Double clicks on Save / TTL / Delete in the key view could open two prompts — applied: the guard now wraps every
  production check, console and key view alike.

Correctness reviewer: 0 blockers, nits applied.

- The console guard was held for the whole command, so a slow command silently swallowed the next Enter even off
  production — applied: the guard only covers classification and the prompt.
- Mock `save_connection` gave every new connection the id `"new"` — applied: `crypto.randomUUID()`.

Maintainability reviewer: applied.

- `productionPrompt` sanitises actions itself instead of trusting every caller to call `plain`.
- One clipping rule (`clipArgs`) instead of per-caller `.slice` caps.
- `confirmProduction(conn, actions, fallback)` replaces the per-caller production / generic confirm branching.
- `redis_is_write` takes one untagged `RedisCmd` (string or array) instead of two optional parameters.

Also found while verifying in the browser mock: `list_connections` returned the same array the mock mutates, so a
saved edit never re-rendered — fixed by returning a copy. The connection dialog's "Badge only for this driver" hint
for Redis/Mongo is gone, since the tag now prompts there too.
