// Runnable self-check: node --experimental-strip-types src/lib/sql.check.ts
import assert from "node:assert/strict";
import { countStatements, statementAt, statementStart } from "./sql.ts";

const doc = "select 1;\n-- a; comment\nselect ';' as x;\n\nupdate t set a = 'b;c' where id = 1";
assert.equal(statementAt(doc, 2), "select 1");
assert.ok(statementAt(doc, doc.indexOf("as x")).endsWith("select ';' as x")); // leading comments stay with the statement
assert.equal(statementAt(doc, doc.length), "update t set a = 'b;c' where id = 1");
assert.equal(statementAt("select 1;", 9), "select 1"); // cursor right after the semicolon
assert.equal(statementAt("", 0), "");
assert.equal(statementStart("select 1; select 2", 12), 9);
assert.equal(statementStart("select 1; select 2", 18), 9); // cursor at the very end is still inside statement 2
assert.equal(statementStart("select 1;", 9), 9); // right after a ';' a new statement begins
assert.equal(countStatements(doc), 3);
assert.equal(countStatements("select 1;"), 1);
assert.equal(countStatements("select 1;\n\n"), 1);
assert.equal(countStatements("select ';'; select 2"), 2);
assert.equal(countStatements(""), 0);
assert.equal(countStatements("select $$'$$; select 2;"), 2); // dollar quotes do not open a string
assert.equal(countStatements("create function f() returns void as $b$ begin; perform 1; end $b$; select 1"), 2);
assert.equal(statementAt("select $$a;b$$ as x; select 2", 3), "select $$a;b$$ as x");
assert.equal(countStatements("select $$ from t; select 2 from t"), 2); // unmatched tag is not a quote
console.log("sql.check ok");
