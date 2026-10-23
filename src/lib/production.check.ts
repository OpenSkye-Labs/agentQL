// Runnable self-check: node --experimental-strip-types src/lib/production.check.ts
import assert from "node:assert/strict";
import { plain, productionPrompt } from "./production.ts";

const prod = { name: "shop", environment: "production" as const };

assert.equal(
  productionPrompt(prod, ['DEL on key "a"', 'SET on key "b"']),
  '"shop" is tagged PRODUCTION. This will run:\n  • DEL on key "a"\n  • SET on key "b"',
);
// Nothing to confirm off production or when nothing writes.
assert.equal(productionPrompt({ name: "shop", environment: "staging" }, ["DEL"]), null);
assert.equal(productionPrompt({ name: "shop", environment: null }, ["DEL"]), null);
assert.equal(productionPrompt(prod, []), null);
// A name cannot add lines to the prompt.
assert.equal(plain("a\n  • DROP everything\u007f"), "a   • DROP everything ");
assert.ok(!productionPrompt({ name: "x\ny", environment: "production" }, ["DEL"])!.includes("x\ny"));

console.log("production.check ok");
