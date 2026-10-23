// Runnable self-check: node --experimental-strip-types src/lib/gridSort.check.ts
import assert from "node:assert/strict";
import { sortOrder as sortBy } from "./gridSort.ts";
import type { Cell } from "./types.ts";

const sortOrder = (rows: Cell[][], column: number, desc: boolean) => sortBy(rows, column, desc, String);

const rows: Cell[][] = [["b10"], [null], ["b2"], [3], ["a"], [null], [1]];
// Numbers before text by value, text in natural order (b2 < b10), NULLs last in both directions.
assert.deepEqual(sortOrder(rows, 0, false), [6, 3, 4, 2, 0, 1, 5]);
assert.deepEqual(sortOrder(rows, 0, true), [0, 2, 4, 3, 6, 1, 5]);
// Numbers compare numerically, not as text.
assert.deepEqual(sortOrder([[10], [9], [100]], 0, false), [1, 0, 2]);
// Stable for equal keys, and an empty column keeps the original order.
assert.deepEqual(sortOrder([["x"], ["x"], ["x"]], 0, false), [0, 1, 2]);
assert.deepEqual(sortOrder([[null], [null]], 0, true), [0, 1]);

// Speed: 200k text values in about half a second here (the old per-comparison localeCompare took ~5 s in the grid);
// the bound is loose so a slow CI runner does not flake.
const big = Array.from({ length: 200_000 }, (_, i) => [`row ${(i * 7919) % 200_000} lorem ipsum`]);
const t = performance.now();
sortOrder(big, 0, false);
const ms = performance.now() - t;
assert.ok(ms < 5000, `200k text sort took ${Math.round(ms)} ms`);

console.log(`gridSort.check ok (200k text sort ${Math.round(ms)} ms)`);
