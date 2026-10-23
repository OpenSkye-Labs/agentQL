# Testing

## Unit tests (no services needed)

```bash
cd src-tauri && cargo test
pnpm typecheck && pnpm build
```

`cargo test --test export` exports a 200k-row SQLite table through the streaming path (every row on disk, cancel and
a refused write leave no file or temp file).

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

## Performance database (15 GB Postgres)

A local Postgres with real volume for testing grid speed, counts, completion on wide catalogues, ERD layout and
the agent on a big schema. Needs Docker (on WSL, `DOCKER=docker.exe` talks to Docker Desktop).

```bash
docker run -d --name agentql-perf-pg -e POSTGRES_PASSWORD=perf -e POSTGRES_DB=perf -p 55433:5432 \
  -v agentql-perf-pg:/var/lib/postgresql/data --shm-size=1g postgres:16 \
  -c shared_buffers=1GB -c work_mem=64MB -c maintenance_work_mem=512MB -c max_wal_size=4GB
until docker exec agentql-perf-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
docker exec agentql-perf-pg pgbench -i -s 100 -U postgres perf        # 10 M rows in public.pgbench_accounts, ~2 min
( mkdir -p ~/datasets/imdb && cd ~/datasets/imdb && \
  for f in title.basics title.ratings name.basics title.principals; do curl -sSLO https://datasets.imdbws.com/$f.tsv.gz; done )
bash scripts/perf/imdb-load.sh                                        # from the repo root; ~6 min load + indexes/FKs
docker exec -i agentql-perf-pg psql -U postgres -d perf < scripts/perf/imdb-verify.sql
```

The loader **drops and recreates the `imdb` schema** on every run, including anything you added to it.

Connection: Postgres · 127.0.0.1 · 55433 · postgres / perf · database `perf`. Sizes after load (2026-10-11):
`imdb.title_principals` 102 M rows, `imdb.name_basics` 15.7 M, `imdb.title_basics` 12.9 M, `title_ratings` 1.7 M,
`public.pgbench_accounts` 10 M; 15 GB on disk. Foreign keys are `NOT VALID` (the public dump has dangling refs).

Things worth timing in the app, cold then warm:

- Open `imdb.title_principals` as a table tab (first page + the deferred `COUNT(*)` estimate).
- Sort that tab by `nconst`, then filter `category = 'director'`.
- ERD of the `imdb` schema and of `public`; schema diff `imdb` → `public`.
- Completion after `p.` in `SELECT p. FROM imdb.title_principals p JOIN imdb.name_basics n ON n.nconst = p.nconst`.
- Export 1 M rows of `pgbench_accounts` to CSV from the table tab: the row count climbs, the app's RSS stays flat
  (at most 2,000 rows are in flight), Cancel removes the partial file.
- Ask the agent: "Which directors have the most titles rated above 8 with at least 10k votes?"
