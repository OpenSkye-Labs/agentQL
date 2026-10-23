# Testing

## Unit tests (no services needed)

```bash
cd src-tauri && cargo test
pnpm typecheck && pnpm build
```

`cargo test --test export` exports a 200k-row SQLite table through the streaming path (every row on disk, cancel and
a refused write leave no file or temp file). With the Postgres and MySQL containers below up,
`cargo test --test live export_cancel -- --ignored --nocapture` checks that Cancel returns within two seconds
mid-result and, on Postgres, while the server has not produced a first row (`pg_sleep`). Last run 2026-10-24:
Postgres returned 0.3 ms after Cancel mid-result and during `pg_sleep(30)`, MySQL 4.5 ms mid-result.

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

## Grid benchmark (M5)

The browser mock serves a 200,000-row × 60-column result (mixed types, NULLs) for `SELECT * FROM bench_wide`.
`scripts/bench-grid.js` measures it inside the page: first paint after the result arrives, 3 s of vertical and of
horizontal scrolling (frames per second, frames over 50 ms, worst frame), and client sort on a text and a numeric
column. Run it on a fresh page load each time:

```bash
pnpm exec vite --port 1450                       # then, with agent-browser on http://localhost:1450/?mock=1:
# connect "shop", New query, type `SELECT * FROM bench_wide`, then
agent-browser eval "$(cat scripts/bench-grid.js)"
```

Measured 2026-10-24 in headless Chromium 149 under WSL2 (a proxy for the app's WebKitGTK / WebView2; per-platform
numbers are M9), fresh loads each, before (three runs) and after (six runs) the M5 grid changes:

|                                      | before                                          | after                                                                              |
| ------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| first paint after the result arrives | 185–210 ms                                      | 85–95 ms                                                                           |
| vertical scroll (400 px per frame)   | 12–14 fps, ~40 frames > 50 ms, worst 184–434 ms | 47–58 fps (51, 57, 48, 58, 57, 47; median 54), 0–4 frames > 50 ms, worst 42–176 ms |
| horizontal scroll                    | 60 fps                                          | 60 fps                                                                             |
| client sort, text column             | 4.0–5.7 s                                       | 0.38–0.44 s                                                                        |
| client sort, numeric column          | ~0.35 s                                         | 0.25–0.37 s                                                                        |
| cells mounted                        | 1,380                                           | 112                                                                                |

What changed: columns are virtualised as well as rows (only cells in view are mounted), row overscan 12 → 6, and the
client sort uses one `Intl.Collator` with each cell's text computed once (`src/lib/gridSort.ts`). The 55 fps bar is met
in three of six runs; each slower run has 2–4 frames of 150–180 ms (garbage-collection pauses, by their shape). Next
lever if it matters in the real webviews: memoised rows, so rows that did not change skip re-rendering while scrolling.
Not measured: the mock hands the result over by reference, so IPC and JSON parsing of 200k rows are left out (the
default row limit is 1,000); the 400 px-per-frame scroll is synthetic and harsher than a wheel or trackpad.

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
  (about 3,000 rows in flight at most), Cancel returns within a second and removes the partial file.
- Ask the agent: "Which directors have the most titles rated above 8 with at least 10k votes?"
