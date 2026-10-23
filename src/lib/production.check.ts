// Runnable self-check: node --experimental-strip-types src/lib/production.check.ts
import assert from "node:assert/strict";
import { clipArgs, plain, productionPrompt } from "./production.ts";

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

// C1 controls and Unicode line/paragraph separators break lines in some native dialogs too.
assert.equal(plain("a\u0085b\u2028c\u2029d"), "a b c d");
// Bidi overrides cannot visually reorder a key in the prompt.
assert.equal(plain("user\u202Egnp.exe\u2066x\u2069"), "user gnp.exe x ");
assert.ok(!productionPrompt(prod, ["DEL a\u202Eb"])!.includes("\u202E"));
// The prompt sanitises actions itself, so a caller cannot forget.
assert.ok(!productionPrompt(prod, ["DEL a\nb"])!.includes("a\nb"));
// Long arguments are clipped one by one with a visible marker, so a later target is never hidden.
const long = "a".repeat(196);
const shown = clipArgs(["DEL", long, "critical-key"]);
assert.ok(shown.includes("critical-key"), shown);
assert.ok(shown.includes("… (196 chars)"), shown);
assert.equal(clipArgs(["GET", "k"]), "GET k");

console.log("production.check ok");
