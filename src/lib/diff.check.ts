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
// Postgres serial defaults carry the schema inside a regclass literal; other literals are left alone.
assert.equal(normaliseDdl("DEFAULT nextval('a.t_id_seq'::regclass)", "a"), "DEFAULT nextval('t_id_seq'::regclass)");
assert.equal(normaliseDdl("DEFAULT 'a.t_id_seq'", "a"), "DEFAULT 'a.t_id_seq'");
{
  const serial = (schema: string) => {
    const o = obj(
      "t",
      [["id", "integer", false]],
      `CREATE TABLE "${schema}"."t" ("id" integer NOT NULL DEFAULT nextval('${schema}.t_id_seq'::regclass))`,
      schema,
    );
    o.details.columns[0].default = `nextval('${schema}.t_id_seq'::regclass)`;
    return o;
  };
  const d = compareSchemas([serial("a")], [serial("b")]);
  assert.equal(d[0].status, "same");
  assert.equal(migrationSql("postgres", "a", d), "");
}
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
// A new NOT NULL column without a default is added nullable with a backfill note.
{
  const before = obj("n", [["id", "int", false]], "v1");
  const after = obj(
    "n",
    [
      ["id", "int", false],
      ["req", "text", false],
    ],
    "v2",
  );
  const s = migrationSql("postgres", "p", compareSchemas([before], [after]));
  assert.ok(s.includes("-- req is NOT NULL without a default on B; backfill, then add the constraint"), s);
  assert.ok(s.includes('ALTER TABLE "p"."n" ADD COLUMN "req" text;'), s);
}
// Added tables keep their foreign keys and list secondary indexes.
const withFk = obj(
  "child",
  [
    ["id", "int", false],
    ["parent_id", "int", true],
  ],
  "x",
);
withFk.details.foreign_keys = [
  { name: "child_parent_fkey", columns: ["parent_id"], ref_schema: "public", ref_table: "parent", ref_columns: ["id"] },
];
withFk.details.indexes = [
  { name: "child_parent_idx", columns: ["parent_id"], unique: false, primary: false, definition: null },
];
assert.equal(
  migrationSql("postgres", "s", compareSchemas([], [withFk])),
  [
    "-- create child",
    'CREATE TABLE "s"."child" (',
    '  "id" int NOT NULL,',
    '  "parent_id" int,',
    '  PRIMARY KEY ("id")',
    ");",
    "-- index child_parent_idx (parent_id)",
    "",
    "-- foreign keys of created tables",
    'ALTER TABLE "s"."child" ADD CONSTRAINT "child_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "s"."parent" ("id");',
    "",
  ].join("\n"),
);
// SQLite cannot ADD CONSTRAINT: the foreign key goes inline in CREATE TABLE and no ALTER is emitted.
{
  const s = migrationSql("sqlite", "main", compareSchemas([], [withFk]));
  assert.ok(s.includes('  CONSTRAINT "child_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "parent" ("id")\n);'), s);
  assert.ok(!s.includes("ALTER TABLE"), s);
}
// References into another schema keep that schema; foreign tables get their own drop statement.
withFk.details.foreign_keys[0].ref_schema = "shared";
assert.ok(migrationSql("postgres", "s", compareSchemas([], [withFk])).includes('REFERENCES "shared"."parent" ("id")'));
const ft = obj("remote", [["id", "int", false]], "x", "public", "foreign");
assert.equal(migrationSql("postgres", "s", compareSchemas([ft], [])), 'DROP FOREIGN TABLE "s"."remote";\n');
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
// Defaults and names from the other database never become code in the copied script.
const evil = obj(
  "e\nSELECT 1",
  [
    ["id", "int", false],
    ["d", "text", true],
  ],
  "x",
  "public",
  "view",
);
evil.details.columns[1].default = "a(); SELECT 1; select(1)";
const evilTable = obj(
  "t",
  [
    ["id", "int", false],
    ["d", "text", true],
  ],
  "x",
);
evilTable.details.columns[1].default = "a(); SELECT 1; select(1)";
evilTable.details.columns[1].extra = "x */ SELECT 1 /*";
const script = migrationSql("mysql", "s", compareSchemas([], [evil, evilTable]));
assert.ok(script.includes("-- create view e SELECT 1; definition on B:"), script);
assert.ok(script.includes("DEFAULT 'a(); SELECT 1; select(1)' /* x * / SELECT 1 /* */"), script);
const gen = obj(
  "g",
  [
    ["id", "int", false],
    ["u", "char(36)", true],
  ],
  "x",
);
gen.details.columns[1].default = "uuid()";
gen.details.columns[1].extra = "DEFAULT_GENERATED";
assert.ok(migrationSql("mysql", "s", compareSchemas([], [gen])).includes("DEFAULT (uuid()) /* DEFAULT_GENERATED */"));
console.log("diff.check ok");
