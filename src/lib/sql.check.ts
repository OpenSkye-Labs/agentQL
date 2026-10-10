// Runnable self-check: node --experimental-strip-types src/lib/sql.check.ts
import assert from "node:assert/strict";
import { keyFilter, quoteIdent, sqlLiteral, statementAt } from "./sql.ts";

const doc = "select 1;\n-- a; comment\nselect ';' as x;\n\nupdate t set a = 'b;c' where id = 1";
assert.equal(statementAt(doc, 2), "select 1");
assert.ok(statementAt(doc, doc.indexOf("as x")).endsWith("select ';' as x")); // leading comments stay with the statement
assert.equal(statementAt(doc, doc.length), "update t set a = 'b;c' where id = 1");
assert.equal(statementAt("select 1;", 9), "select 1"); // cursor right after the semicolon
assert.equal(statementAt("", 0), "");

assert.equal(quoteIdent("postgres", 'a"b'), '"a""b"');
assert.equal(quoteIdent("mysql", "a`b"), "`a``b`");
assert.equal(sqlLiteral("postgres", "O'Hara\\x"), "'O''Hara\\x'");
assert.equal(sqlLiteral("mysql", "a\\b'c"), "'a\\\\b''c'");
assert.equal(sqlLiteral("postgres", 42), "42");
assert.equal(sqlLiteral("sqlite", true), "1");
assert.equal(sqlLiteral("postgres", { a: 1 }), `'{"a":1}'`);
assert.equal(sqlLiteral("postgres", { $bytes: "AAEC", len: 3 }), "decode('AAEC', 'base64')");
assert.equal(sqlLiteral("mysql", { $bytes: "AAEC", len: 3 }), "FROM_BASE64('AAEC')");
assert.equal(sqlLiteral("sqlite", { $bytes: "AAEC", len: 3 }), "X'000102'");
assert.equal(keyFilter("postgres", { id: 7, kind: "x" }), `"id" = 7 AND "kind" = 'x'`);
assert.equal(keyFilter("postgres", { id: null }), null);
assert.equal(keyFilter("postgres", {}), null);
console.log("sql.check ok");
