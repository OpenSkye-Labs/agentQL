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

## Findings from the first live run (2026-10-10)
- MySQL rejects `START TRANSACTION READ ONLY` over the prepared-statement protocol → use `SET TRANSACTION READ ONLY` + `begin()`.
- RESP2 Redis returns `HGETALL` as a flat array → normalised to an object in `get_key`.
- SQLite `DECIMAL` has REAL affinity → numbers, not strings (test expectation fixed).
