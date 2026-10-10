// Runnable self-check: node --experimental-strip-types src/lib/diff.check.ts
import assert from "node:assert/strict";
import { diffLines, formatDiff } from "./diff.ts";
import { compareSchemas, migrationSql, normaliseDdl } from "./schemaDiff.ts";
import type { SchemaObject } from "./types.ts";

assert.deepEqual(diffLines("a\nb\nc", "a\nx\nc"), [
  { kind: "same", text: "a" },
  { kind: "del", text: "b" },
  { kind: "add", text: "x" },
  { kind: "same", text: "c" },
]);
assert.deepEqual(diffLines("", "a"), [{ kind: "add", text: "a" }]);
assert.deepEqual(diffLines("a", ""), [{ kind: "del", text: "a" }]);
assert.deepEqual(diffLines("same", "same"), [{ kind: "same", text: "same" }]);
assert.equal(formatDiff(diffLines("a\nb", "b\nc")), "- a\n  b\n+ c");

const obj = (
  name: string,
  cols: [string, string, boolean][],
  ddl: string,
  schema = "public",
  kind = "table",
): SchemaObject => ({
  table: { schema, name, kind, row_estimate: null },
  details: {
    columns: cols.map(([n, t, nullable], i) => ({
      name: n,
      data_type: t,
      nullable,
      default: null,
      is_primary: i === 0,
      position: i + 1,
      comment: null,
      extra: null,
    })),
    indexes: [],
    foreign_keys: [],
    ddl,
  },
});
assert.equal(
  normaliseDdl("CREATE TABLE t (...) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4  "),
  "CREATE TABLE t (...) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
);
// Schema qualification is noise when comparing a.t with b.t.
assert.equal(
  normaliseDdl('CREATE TABLE "app"."t" (x int REFERENCES "app"."u")', "app"),
  'CREATE TABLE "t" (x int REFERENCES "u")',
);
assert.equal(normaliseDdl("CREATE TABLE `app`.`t` (x int)", "app"), "CREATE TABLE `t` (x int)");
assert.equal(normaliseDdl("CREATE TABLE app.t (x int)", "app"), "CREATE TABLE t (x int)");
assert.equal(normaliseDdl("CREATE TABLE myapp.t (x int)", "app"), "CREATE TABLE myapp.t (x int)"); // not a prefix of another name
assert.equal(
  compareSchemas(
    [obj("t", [["id", "int", false]], 'CREATE TABLE "a"."t" ("id" int)', "a")],
    [obj("t", [["id", "int", false]], 'CREATE TABLE "b"."t" ("id" int)', "b")],
  )[0].status,
  "same",
);

const left = [
  obj(
    "a",
    [
      ["id", "int", false],
      ["old", "text", true],
    ],
    "create a v1",
  ),
  obj("gone", [["id", "int", false]], "create gone"),
  obj("mv", [["id", "int", false]], "create mv", "public", "matview"),
  obj("v", [["id", "int", false]], "create view v as select 1", "public", "view"),
];
const right = [
  obj(
    "a",
    [
      ["id", "bigint", false],
      ["fresh", "text", true],
    ],
    "create a v2",
  ),
  obj(
    "new",
    [
      ["id", "int", false],
      ["label", "text", true],
    ],
    "create new",
  ),
  obj("v", [["id", "int", false]], "create view v as select 2", "public", "view"),
];
const diffs = compareSchemas(left, right);
assert.deepEqual(
  diffs.map((d) => [d.name, d.status]),
  [
    ["a", "changed"],
    ["gone", "removed"],
    ["mv", "removed"],
    ["new", "added"],
    ["v", "changed"],
  ],
);
// The script runs on A (its schema and driver), moving it towards B.
assert.equal(
  migrationSql("mysql", "src", diffs),
  [
    "-- alter a",
    "ALTER TABLE `src`.`a` ADD COLUMN `fresh` text;",
    "ALTER TABLE `src`.`a` DROP COLUMN `old`;",
    "-- column id: `id` int NOT NULL  ->  `id` bigint NOT NULL",
    "",
    "DROP TABLE `src`.`gone`;",
    "",
    "DROP MATERIALIZED VIEW `src`.`mv`;",
    "",
    "-- create new",
    "CREATE TABLE `src`.`new` (",
    "  `id` int NOT NULL,",
    "  `label` text,",
    "  PRIMARY KEY (`id`)",
    ");",
    "",
    "-- view v differs; definition on B:",
    "-- create view v as select 2",
    "",
  ].join("\n"),
);
assert.equal(migrationSql("postgres", "public", compareSchemas(left, left)), "");
// Literals keep their content; MySQL string defaults are quoted and AUTO_INCREMENT survives.
assert.equal(
  normaliseDdl("CREATE TABLE a.t (x text DEFAULT 'a.example')", "a"),
  "CREATE TABLE t (x text DEFAULT 'a.example')",
);
const my = obj(
  "m",
  [
    ["id", "int", false],
    ["status", "varchar(20)", false],
    ["ts", "datetime", true],
  ],
  "x",
);
my.details.columns[0].extra = "auto_increment";
my.details.columns[1].default = "pending";
my.details.columns[2].default = "CURRENT_TIMESTAMP";
assert.equal(
  migrationSql("mysql", "s", compareSchemas([], [my])),
  "-- create m\nCREATE TABLE `s`.`m` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `status` varchar(20) NOT NULL DEFAULT 'pending',\n  `ts` datetime DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (`id`)\n);\n",
);
console.log("diff.check ok");
