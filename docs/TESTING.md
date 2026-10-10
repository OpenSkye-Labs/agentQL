# Testing

## Unit tests (no services needed)

```bash
cd src-tauri && cargo test
pnpm typecheck && pnpm build
```

## Live driver smoke tests

Throwaway containers on non-default ports (safe to run next to your own databases):

```bash
docker run -d --rm --name agentql-test-pg    -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=demo -p 55432:5432 postgres:16-alpine
docker run -d --rm --name agentql-test-mysql -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=demo -p 53306:3306 mysql:8
docker run -d --rm --name agentql-test-maria -e MARIADB_ROOT_PASSWORD=secret -e MARIADB_DATABASE=demo -p 53307:3306 mariadb:11
docker run -d --rm --name agentql-test-mongo -p 57017:27017 mongo:7
docker run -d --rm --name agentql-test-redis -p 56379:6379 redis:7-alpine

cd src-tauri && cargo test --test live -- --ignored --nocapture
docker rm -f agentql-test-pg agentql-test-mysql agentql-test-maria agentql-test-mongo agentql-test-redis
```

`tests/live.rs` covers: connect (fields and URL+injected password), multi-statement execution, dynamic decoding
(decimals, booleans, NULLs, arrays with NULL elements, jsonb, money), empty-result headers, introspection
(schemas/tables/details/DDL), browse SQL + count, database-enforced read-only, edit → SQL → transactional apply,
EXPLAIN, Redis scan/typed get/commands/info, Mongo insert/find/aggregate/replace/delete/collection info.

## Manual app run

```bash
pnpm tauri dev
```

Add a connection to one of the containers above (e.g. Postgres · 127.0.0.1 · 55432 · postgres / secret · demo).

## Editor completion checklist (M7)

Run `pnpm check` for the pure-function part (`src/lib/completion.check.ts`). In the app, against a database with at
least two tables linked by a foreign key (the demo containers above, or `?mock=1` in the browser: `Claim.candidateId`
→ `Candidate.id`), expand the schema in the sidebar and check:

- [ ] `SELECT * FROM ord` offers the `orders` table (and `public.orders`).
- [ ] `SELECT o. FROM orders o` — after typing `o.` the popup lists only the `orders` columns with their types.
- [ ] `FROM orders AS o` and `FROM public.orders o` resolve the same way; `FROM orders WHERE o.` does not treat
      `WHERE` as an alias.
- [ ] `SELECT * FROM orders o JOIN ` + Ctrl+Space lists `customers c ON c.id = o.customer_id` (forward FK) and
      `order_items o2 ON o2.order_id = o.id` (reverse FK) above the plain table names; picking one inserts the clause.
- [ ] Keywords follow the clause: after `SELECT id ` → `FROM` first; after `FROM t ` → `WHERE`/`JOIN`/`ORDER BY`;
      after `WHERE x = 1 ` → `AND`/`OR`; after `ORDER BY id ` → `ASC`/`DESC`. `RETURNING`/`ILIKE` only on Postgres.
- [ ] Inside a string or comment (`SELECT 'F`, `-- wh`) no keyword or snippet completion appears.
- [ ] Saved query with trigger `topn` and body `SELECT * FROM ${1:table} ORDER BY ${2:col} DESC LIMIT ${3:10}`:
      typing `topn` offers it; accepting it selects `table`, Tab moves to `col`, then `10`.
- [ ] Loading that query from the Saved menu does the same placeholder walk; a saved query without numbered
      placeholders loads verbatim (`SELECT '${HOME}'` keeps its braces).
- [ ] Settings → "Vim keymap" on: `Esc`, `dd`, `ciw` work; `Mod+Enter` still runs; off again restores normal editing.
- [ ] `Mod+Shift+/` and the keyboard button in the query toolbar open the shortcut reference; `Mod+/` still
      toggles a line comment.
- [ ] SQLite: `customer_id INTEGER REFERENCES customers` (no column list) still yields `customers c ON c.id = …`.
- [ ] Disconnect/reconnect or `refresh schema` after `CREATE TABLE` makes the new table's columns complete.

## Findings from the first live run (2026-10-10)

- MySQL rejects `START TRANSACTION READ ONLY` over the prepared-statement protocol → use `SET TRANSACTION READ ONLY` + `begin()`.
- RESP2 Redis returns `HGETALL` as a flat array → normalised to an object in `get_key`.
- SQLite `DECIMAL` has REAL affinity → numbers, not strings (test expectation fixed).
