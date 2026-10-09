// Runnable self-check: node --experimental-strip-types src/lib/sql.check.ts
import assert from "node:assert/strict";
import { statementAt } from "./sql.ts";

const doc = "select 1;\n-- a; comment\nselect ';' as x;\n\nupdate t set a = 'b;c' where id = 1";
assert.equal(statementAt(doc, 2), "select 1");
assert.ok(statementAt(doc, doc.indexOf("as x")).endsWith("select ';' as x")); // leading comments stay with the statement
assert.equal(statementAt(doc, doc.length), "update t set a = 'b;c' where id = 1");
assert.equal(statementAt("select 1;", 9), "select 1"); // cursor right after the semicolon
assert.equal(statementAt("", 0), "");
console.log("sql.check ok");
