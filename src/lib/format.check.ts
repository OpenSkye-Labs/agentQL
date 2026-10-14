import assert from "node:assert/strict";
import { cellPreview, cellText, parseCell } from "./format.ts";

const emb = Array.from({ length: 384 }, (_, i) => i / 1000);
assert.equal(cellPreview(emb), "[384 dims] 0, 0.001, 0.002, 0.003, …");
assert.equal(cellPreview([1, 2, 3]), "[1,2,3]");
assert.equal(cellPreview(["a", "b"]), cellText(["a", "b"]));
assert.equal(cellPreview({ k: 1 }), '{"k":1}');

// Typing a vector literal into a vector cell round-trips as a float array (sqlLiteral then quotes it; Postgres casts).
assert.deepEqual(parseCell("[0.1, 0.2]", "vector(2)", [0, 0]), [0.1, 0.2]);
assert.deepEqual(parseCell("[1,2]", "vector(2)", null), [1, 2]);

console.log("format.check ok");
