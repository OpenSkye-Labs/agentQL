// Runnable self-check: node --experimental-strip-types src/lib/queries.check.ts
import assert from "node:assert/strict";
import { withVersion } from "./queries.ts";
import { MAX_QUERY_VERSIONS, type SavedQuery } from "./types.ts";

const base: SavedQuery = { id: "q", connection_id: "c", name: "n", sql: "select 1", created_at: "t0" };
const first = withVersion(undefined, base, "t1");
assert.deepEqual(first.versions, []);
assert.equal(first.updated_at, "t1");

const same = withVersion(first, { ...base, sql: "select 1" }, "t2");
assert.deepEqual(same.versions, [], "unchanged text records no version");

const edited = withVersion(first, { ...base, sql: "select 2" }, "t2");
assert.deepEqual(edited.versions, [{ sql: "select 1", ts: "t1" }]);

let q = edited;
for (let i = 3; i < MAX_QUERY_VERSIONS + 10; i++) q = withVersion(q, { ...base, sql: `select ${i}` }, `t${i}`);
assert.equal(q.versions?.length, MAX_QUERY_VERSIONS, "capped");
assert.equal(q.versions?.[0].sql, `select ${MAX_QUERY_VERSIONS + 8}`, "newest first");
console.log("queries.check ok");
