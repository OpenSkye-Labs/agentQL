// Runnable self-check: node --experimental-strip-types src/lib/mock.check.ts
import assert from "node:assert/strict";
import { pickRun } from "./mockAgent.ts";
import { SPECS, benchWide, catalog, chartDataFor, dashboards, tablePage } from "./mockData.ts";

// The four demo prompts route to their scripted runs.
assert.equal(pickRun("Chart revenue per day for the last two weeks"), "revenue");
assert.equal(pickRun("Which customers spend the most?"), "customers");
assert.equal(pickRun("Mark order 1042 as cancelled"), "write");
assert.equal(pickRun("What tables are here?"), "fallback");
assert.equal(pickRun("Refund orders for this customer"), "write");

// Every row matches its columns, and every foreign key points at a real table's id column.
for (const [name, s] of Object.entries(SPECS)) {
  assert.equal(tablePage(name, 0, 3, "").rows[0].length, s.cols.length, name);
  for (const [col, ref] of s.fks ?? []) {
    assert.ok(
      s.cols.some(([c]) => c === col),
      `${name}.${col}`,
    );
    assert.ok(
      SPECS[ref]?.cols.some(([c]) => c === "id"),
      `${name}.${col} -> ${ref}`,
    );
  }
}
assert.equal(catalog("public").foreign_keys.length, 9);

// Deterministic, paging-consistent, honest about truncation.
assert.deepEqual(tablePage("orders", 40, 5, "").rows, tablePage("orders", 40, 5, "").rows);
assert.deepEqual(tablePage("orders", 41, 1, "").rows[0], tablePage("orders", 40, 2, "").rows[1]);
assert.equal(tablePage("orders", 41, 1, "").rows[0][2], "processing"); // order 1042, the write demo
assert.equal(tablePage("orders", 0, 10, "").truncated, true);
assert.equal(tablePage("categories", 0, 100, "").truncated, false);

// Dashboard charts get data with the columns they plot.
for (const c of dashboards[0].charts) {
  const cols = chartDataFor(c.source.kind === "sql" ? c.source.sql : "").columns.map((x) => x.name);
  for (const y of [c.x!, ...c.y]) assert.ok(cols.includes(y), `${c.title}: ${y}`);
}
// Grid benchmark fixture: shape, NULLs present, deterministic (small size here; the mock serves 200k × 60).
const bench = benchWide(1000, 60);
assert.equal(bench.rows.length, 1000);
assert.equal(bench.columns.length, 60);
assert.ok(bench.rows.every((r) => r.length === 60));
assert.ok(bench.rows.some((r) => r.includes(null)));
const first = bench.rows[999];
assert.notEqual(benchWide(1000, 60), bench, "regenerated, not the cached object");
assert.deepEqual(benchWide(1000, 60).rows[999], first);

console.log("mock.check ok");
