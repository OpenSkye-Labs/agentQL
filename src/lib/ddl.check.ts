// Runnable self-check: node --experimental-strip-types src/lib/ddl.check.ts
import assert from "node:assert/strict";
import {
  addColumnSql,
  addIndexSql,
  alterColumnSql,
  columnDef,
  dropColumnSql,
  dropForeignKeySql,
  dropIndexSql,
  dropTableSql,
  qualifiedName,
  renameTableSql,
} from "./ddl.ts";
import type { ColumnInfo } from "./types.ts";

const col = (o: Partial<ColumnInfo>): ColumnInfo => ({
  name: "status",
  data_type: "text",
  nullable: true,
  default: null,
  is_primary: false,
  position: 1,
  comment: null,
  extra: null,
  ...o,
});

assert.equal(qualifiedName("postgres", "public", "orders"), '"public"."orders"');
assert.equal(qualifiedName("mysql", "shop", "orders"), "`shop`.`orders`");
assert.equal(qualifiedName("sqlite", "main", "orders"), '"main"."orders"');

const warn =
  "-- MODIFY replaces the whole definition: charset, collation and attributes not listed here fall back to the table defaults. Compare with SHOW CREATE TABLE before running.";
const pg = qualifiedName("postgres", "public", "orders");
assert.equal(
  addColumnSql("postgres", pg, col({ name: "deleted_at", data_type: "timestamptz" })),
  `ALTER TABLE ${pg} ADD COLUMN "deleted_at" timestamptz;`,
);
// MySQL quotes a plain string default; expressions stay raw.
assert.equal(
  addColumnSql("mysql", "`orders`", col({ nullable: false, default: "active" })),
  "ALTER TABLE `orders` ADD COLUMN `status` text NOT NULL DEFAULT 'active';",
);
assert.equal(
  addColumnSql("mysql", "`orders`", col({ name: "at", data_type: "datetime", default: "CURRENT_TIMESTAMP" })),
  "ALTER TABLE `orders` ADD COLUMN `at` datetime DEFAULT CURRENT_TIMESTAMP;",
);
// Typed in the dialog, parentheses mark an expression; an introspected default never gets that rule, so a
// string default from another database (schema diff) can never become code.
assert.equal(
  addColumnSql("mysql", "`t`", col({ name: "k", data_type: "char(36)", default: "(uuid())" })),
  "ALTER TABLE `t` ADD COLUMN `k` char(36) DEFAULT (uuid());",
);
assert.equal(
  columnDef("mysql", col({ default: "(1); DROP TABLE t; -- (" })),
  "`status` text DEFAULT '(1); DROP TABLE t; -- ('",
);
// Backslashes are escape characters in MySQL literals.
assert.equal(
  addColumnSql("mysql", "`t`", col({ name: "p", data_type: "text", default: "C:\\tmp\\" })),
  "ALTER TABLE `t` ADD COLUMN `p` text DEFAULT 'C:\\\\tmp\\\\';",
);
// MariaDB reports defaults as SQL already ('active', current_timestamp()): emitted verbatim, never re-quoted.
assert.equal(
  alterColumnSql("mariadb", "`t`", col({ default: "'active'" }), {
    ...col({}),
    data_type: "varchar(10)",
    default: "'active'",
  }),
  `${warn}\nALTER TABLE \`t\` MODIFY COLUMN \`status\` varchar(10) DEFAULT 'active';`,
);
// SQLite warns when NOT NULL has no default.
assert.match(addColumnSql("sqlite", '"orders"', col({ nullable: false })), /^-- SQLite: a NOT NULL column/);

assert.equal(dropColumnSql("postgres", pg, 'we"ird'), `ALTER TABLE ${pg} DROP COLUMN "we""ird";`);

// Postgres: one statement per change, in a stable order.
const before = col({ name: "status", data_type: "text", nullable: true, default: null });
assert.equal(alterColumnSql("postgres", pg, before, before), "");
assert.equal(
  alterColumnSql("postgres", pg, before, {
    name: "state",
    data_type: "varchar(20)",
    nullable: false,
    default: "'new'",
  }),
  [
    `ALTER TABLE ${pg} RENAME COLUMN "status" TO "state";`,
    `ALTER TABLE ${pg} ALTER COLUMN "state" TYPE varchar(20) USING "state"::varchar(20);`,
    `ALTER TABLE ${pg} ALTER COLUMN "state" SET NOT NULL;`,
    `ALTER TABLE ${pg} ALTER COLUMN "state" SET DEFAULT 'new';`,
  ].join("\n"),
);
assert.equal(
  alterColumnSql("postgres", pg, col({ default: "'x'" }), { ...before, default: null }),
  `ALTER TABLE ${pg} ALTER COLUMN "status" DROP DEFAULT;`,
);
// MySQL: RENAME COLUMN and ALTER COLUMN SET/DROP DEFAULT keep every other attribute.
assert.equal(
  alterColumnSql("mysql", "`t`", before, { ...before, name: "state" }),
  "ALTER TABLE `t` RENAME COLUMN `status` TO `state`;",
);
assert.equal(
  alterColumnSql("mysql", "`t`", before, { ...before, default: "new" }),
  "ALTER TABLE `t` ALTER COLUMN `status` SET DEFAULT 'new';",
);
assert.equal(
  alterColumnSql("mysql", "`t`", before, { ...before, default: "(uuid())" }),
  "ALTER TABLE `t` ALTER COLUMN `status` SET DEFAULT (uuid());",
);
assert.equal(
  alterColumnSql("mysql", "`t`", col({ default: "x" }), { ...before, default: null }),
  "ALTER TABLE `t` ALTER COLUMN `status` DROP DEFAULT;",
);
// Type / nullability need MODIFY: the full definition with AUTO_INCREMENT, ON UPDATE and COMMENT re-emitted,
// the DEFAULT_GENERATED classification kept, and a warning about what is not introspected.
assert.equal(
  alterColumnSql("mysql", "`t`", col({ name: "id", data_type: "int", nullable: false, extra: "auto_increment" }), {
    name: "id",
    data_type: "bigint",
    nullable: false,
    default: null,
  }),
  `${warn}\nALTER TABLE \`t\` MODIFY COLUMN \`id\` bigint NOT NULL AUTO_INCREMENT;`,
);
assert.equal(
  alterColumnSql(
    "mysql",
    "`t`",
    col({
      name: "updated_at",
      data_type: "datetime",
      nullable: false,
      default: "CURRENT_TIMESTAMP",
      extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP",
      comment: "it's \\ touched",
    }),
    { name: "updated_at", data_type: "datetime(6)", nullable: false, default: "CURRENT_TIMESTAMP" },
  ),
  `${warn}\nALTER TABLE \`t\` MODIFY COLUMN \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'it''s \\\\ touched';`,
);
assert.equal(
  alterColumnSql(
    "mysql",
    "`t`",
    col({ name: "k", data_type: "char(36)", default: "uuid()", extra: "DEFAULT_GENERATED" }),
    {
      name: "k",
      data_type: "varchar(36)",
      nullable: true,
      default: "uuid()",
    },
  ),
  `${warn}\nALTER TABLE \`t\` MODIFY COLUMN \`k\` varchar(36) DEFAULT (uuid());`,
);
// Empty-string defaults are preserved verbatim.
assert.equal(
  alterColumnSql("mysql", "`t`", col({ default: "" }), { ...before, data_type: "varchar(10)", default: "" }),
  `${warn}\nALTER TABLE \`t\` MODIFY COLUMN \`status\` varchar(10) DEFAULT '';`,
);
assert.match(
  alterColumnSql("mysql", "`t`", col({ name: "full", extra: "STORED GENERATED" }), { ...before, name: "full2" }),
  /^-- full is a generated column/,
);
// Postgres: an old default is dropped before a type change and restored after it.
assert.equal(
  alterColumnSql("postgres", pg, col({ data_type: "text", default: "'0'" }), {
    ...before,
    data_type: "integer",
    default: "'0'",
  }),
  [
    `ALTER TABLE ${pg} ALTER COLUMN "status" DROP DEFAULT;`,
    `ALTER TABLE ${pg} ALTER COLUMN "status" TYPE integer USING "status"::integer;`,
    `ALTER TABLE ${pg} ALTER COLUMN "status" SET DEFAULT '0';`,
  ].join("\n"),
);
assert.equal(
  alterColumnSql("postgres", pg, col({ data_type: "text", default: "'0'" }), {
    ...before,
    data_type: "integer",
    default: null,
  }),
  [
    `ALTER TABLE ${pg} ALTER COLUMN "status" DROP DEFAULT;`,
    `ALTER TABLE ${pg} ALTER COLUMN "status" TYPE integer USING "status"::integer;`,
  ].join("\n"),
);

// SQLite: rename works, the rest is a comment.
assert.equal(
  alterColumnSql("sqlite", '"t"', before, { ...before, name: "state" }),
  'ALTER TABLE "t" RENAME COLUMN "status" TO "state";',
);
assert.match(alterColumnSql("sqlite", '"t"', before, { ...before, nullable: false }), /^-- SQLite cannot change/);

assert.equal(renameTableSql("postgres", "public", pg, "orders2"), `ALTER TABLE ${pg} RENAME TO "orders2";`);
// MySQL keeps the table in its own database even when another one is current.
assert.equal(renameTableSql("mariadb", "other", "`other`.`t`", "t2"), "RENAME TABLE `other`.`t` TO `other`.`t2`;");
assert.equal(dropTableSql(pg), `DROP TABLE ${pg};`);

assert.equal(
  addIndexSql("postgres", "public", "orders", {
    name: "orders_customer_idx",
    columns: ["customer_id", "created_at"],
    unique: false,
  }),
  `CREATE INDEX "orders_customer_idx" ON ${pg} ("customer_id", "created_at");`,
);
assert.equal(
  addIndexSql("mysql", "shop", "t", { name: "u", columns: ["email"], unique: true }),
  "CREATE UNIQUE INDEX `u` ON `shop`.`t` (`email`);",
);
// SQLite: schema goes on the index name, the table stays bare.
assert.equal(
  addIndexSql("sqlite", "aux", "t", { name: "u", columns: ["email"], unique: true }),
  'CREATE UNIQUE INDEX "aux"."u" ON "t" ("email");',
);
assert.equal(
  addIndexSql("sqlite", "main", "t", { name: "u", columns: ["email"], unique: false }),
  'CREATE INDEX "main"."u" ON "t" ("email");',
);
assert.equal(
  dropIndexSql("postgres", "public", pg, { name: "orders_customer_idx", unique: false }),
  'DROP INDEX "public"."orders_customer_idx";',
);
// A unique index may back a constraint: the DROP CONSTRAINT alternative rides along as a comment.
assert.equal(
  dropIndexSql("postgres", "public", pg, { name: "orders_email_key", unique: true }),
  [
    "-- If this index backs a UNIQUE constraint, DROP INDEX fails; drop the constraint instead:",
    `-- ALTER TABLE ${pg} DROP CONSTRAINT "orders_email_key";`,
    'DROP INDEX "public"."orders_email_key";',
  ].join("\n"),
);
assert.equal(dropIndexSql("mysql", "shop", "`shop`.`t`", { name: "u", unique: true }), "DROP INDEX `u` ON `shop`.`t`;");
assert.equal(dropIndexSql("sqlite", "main", '"t"', { name: "u", unique: true }), 'DROP INDEX "main"."u";');
assert.match(
  dropIndexSql("sqlite", "main", '"t"', { name: "sqlite_autoindex_t_1", unique: true }),
  /^-- sqlite_autoindex_t_1 backs/,
);

assert.equal(
  dropForeignKeySql("postgres", pg, "orders_customer_fkey"),
  `ALTER TABLE ${pg} DROP CONSTRAINT "orders_customer_fkey";`,
);
assert.equal(dropForeignKeySql("mysql", "`t`", "fk"), "ALTER TABLE `t` DROP FOREIGN KEY `fk`;");
assert.match(dropForeignKeySql("sqlite", '"t"', "fk"), /^-- SQLite cannot drop/);

console.log("ddl.check: ok");
