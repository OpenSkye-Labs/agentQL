import type { ColumnInfo } from "./types.ts";
import { quoteIdent, sqlLiteral, type QuoteDriver } from "./sql.ts";

/**
 * Structure edits as reviewable DDL. Nothing here runs SQL: the structure tab generates a statement and opens
 * it in a query tab, the same "edit becomes SQL you review" path the data grid uses.
 */

export const isMysql = (driver: QuoteDriver) => driver === "mysql" || driver === "mariadb";

// MySQL reports string defaults unquoted. Only a strict allow-list (or MySQL 8's DEFAULT_GENERATED flag) is
// emitted verbatim; everything else is quoted so a default from the other database can never become code.
// `typed` marks a value the user entered in the column dialog: there, and only there, wrapping it in
// parentheses makes it an expression. Introspected defaults never get that rule.
const LITERAL = /^(-?\d+(\.\d+)?|NULL|CURRENT_(TIMESTAMP|DATE|TIME)(\(\d*\))?|b'[01]+')$/i;
const isExpression = (c: { default: string | null; extra?: string | null }, typed: boolean) =>
  /DEFAULT_GENERATED/i.test(c.extra ?? "") ||
  LITERAL.test(c.default ?? "") ||
  (typed && /^\(.*\)$/s.test(c.default ?? ""));

/** Keep names and DDL on one comment line: no CR/LF, no comment terminator. */
export const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /");

/** What the column dialog edits; the default uses the driver's introspected form (see `defaultSql`). */
export type ColumnDraft = Pick<ColumnInfo, "name" | "data_type" | "nullable" | "default"> & { extra?: string | null };

// ponytail: MariaDB 10.2.7+ reports COLUMN_DEFAULT as SQL (strings quoted, expressions raw), so it is emitted
// verbatim like Postgres; older MariaDB reported MySQL-style unquoted strings and would need the mysql branch.
const defaultSql = (driver: QuoteDriver, c: ColumnDraft, typed: boolean) => {
  const d = c.default!;
  if (driver !== "mysql") return d;
  if (!isExpression(c, typed)) return sqlLiteral(driver, d);
  // MySQL 8 expression defaults need parentheses; CURRENT_TIMESTAMP, numbers and NULL do not.
  return LITERAL.test(d) || d.startsWith("(") ? d : `(${d})`;
};

export function columnDef(driver: QuoteDriver, c: ColumnDraft, typed = false) {
  let s = `${quoteIdent(driver, c.name)} ${c.data_type}`;
  if (!c.nullable) s += " NOT NULL";
  if (c.default != null) s += ` DEFAULT ${defaultSql(driver, c, typed)}`;
  if (c.extra) s += /auto_increment/i.test(c.extra) ? " AUTO_INCREMENT" : ` /* ${oneLine(c.extra)} */`;
  return s;
}

/** `"schema"."name"`; SQLite keeps `main` too, so a temp table of the same name cannot shadow the target. */
export function qualifiedName(driver: QuoteDriver, schema: string, name: string) {
  const q = (s: string) => quoteIdent(driver, s);
  return `${q(schema)}.${q(name)}`;
}

const comment = (text: string) => `-- ${oneLine(text)}`;

export function addColumnSql(driver: QuoteDriver, table: string, c: ColumnDraft): string {
  const lines = [`ALTER TABLE ${table} ADD COLUMN ${columnDef(driver, c, true)};`];
  if (driver === "sqlite" && !c.nullable && c.default == null)
    lines.unshift(comment("SQLite: a NOT NULL column added to an existing table needs a DEFAULT."));
  return lines.join("\n");
}

export function dropColumnSql(driver: QuoteDriver, table: string, name: string): string {
  return `ALTER TABLE ${table} DROP COLUMN ${quoteIdent(driver, name)};`;
}

/**
 * Statements that turn `before` into `after`. Postgres gets one ALTER per change, MySQL one CHANGE/MODIFY with
 * the full definition, SQLite can only rename (anything else is a comment explaining the table rebuild).
 */
export function alterColumnSql(driver: QuoteDriver, table: string, before: ColumnInfo, after: ColumnDraft): string {
  const q = (s: string) => quoteIdent(driver, s);
  const renamed = before.name !== after.name;
  const retyped = before.data_type !== after.data_type;
  const nullChanged = before.nullable !== after.nullable;
  const defaultChanged = (before.default ?? null) !== (after.default ?? null);
  if (!renamed && !retyped && !nullChanged && !defaultChanged) return "";
  const lines: string[] = [];

  if (isMysql(driver)) {
    const extra = before.extra ?? "";
    if (/\bGENERATED\b/i.test(extra) && !/DEFAULT_GENERATED/i.test(extra))
      return comment(`${before.name} is a generated column; its expression is not introspected, edit it by hand.`);
    // ponytail: RENAME COLUMN / ALTER COLUMN SET DEFAULT keep every other attribute; they need MySQL 8.0 or
    // MariaDB 10.5. Older servers would need CHANGE COLUMN with the full definition.
    if (renamed) lines.push(`ALTER TABLE ${table} RENAME COLUMN ${q(before.name)} TO ${q(after.name)};`);
    const col = `ALTER TABLE ${table} ALTER COLUMN ${q(after.name)}`;
    if (retyped || nullChanged) {
      // MODIFY replaces the whole definition: reproduce what is introspected, say what is not.
      const keepFlag = !defaultChanged && /DEFAULT_GENERATED/i.test(extra);
      let def = `${q(after.name)} ${after.data_type}`;
      if (!after.nullable) def += " NOT NULL";
      if (after.default != null)
        def += ` DEFAULT ${defaultSql(driver, { ...after, extra: keepFlag ? "DEFAULT_GENERATED" : null }, defaultChanged)}`;
      if (/auto_increment/i.test(extra)) def += " AUTO_INCREMENT";
      const onUpdate = /\bon update\s+(.+)$/i.exec(extra);
      if (onUpdate) def += ` ON UPDATE ${onUpdate[1].trim()}`;
      if (before.comment != null) def += ` COMMENT ${sqlLiteral(driver, before.comment)}`;
      lines.push(
        comment(
          "MODIFY replaces the whole definition: charset, collation and attributes not listed here fall back to the table defaults. Compare with SHOW CREATE TABLE before running.",
        ),
        `ALTER TABLE ${table} MODIFY COLUMN ${def};`,
      );
    } else if (defaultChanged) {
      lines.push(
        after.default == null
          ? `${col} DROP DEFAULT;`
          : `${col} SET DEFAULT ${defaultSql(driver, { ...after, extra: null }, true)};`,
      );
    }
    return lines.join("\n");
  }

  if (renamed) lines.push(`ALTER TABLE ${table} RENAME COLUMN ${q(before.name)} TO ${q(after.name)};`);
  if (driver === "sqlite") {
    if (retyped || nullChanged || defaultChanged)
      lines.push(
        comment("SQLite cannot change a column's type, nullability or default in place."),
        comment(
          "Rebuild: CREATE TABLE new (...); INSERT INTO new SELECT ... FROM old; DROP TABLE old; ALTER TABLE new RENAME TO old;",
        ),
      );
    return lines.join("\n");
  }

  const col = `ALTER TABLE ${table} ALTER COLUMN ${q(after.name)}`;
  // An old default may not cast to the new type even when USING converts the rows: drop it first, restore after.
  const dropFirst = retyped && before.default != null;
  if (dropFirst) lines.push(`${col} DROP DEFAULT;`);
  if (retyped) lines.push(`${col} TYPE ${after.data_type} USING ${q(after.name)}::${after.data_type};`);
  if (nullChanged) lines.push(`${col} ${after.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
  if (after.default != null && (defaultChanged || dropFirst)) lines.push(`${col} SET DEFAULT ${after.default};`);
  else if (after.default == null && defaultChanged && !dropFirst) lines.push(`${col} DROP DEFAULT;`);
  return lines.join("\n");
}

/** MySQL's destination is qualified so the table stays in its database even when it is not the current one. */
export function renameTableSql(driver: QuoteDriver, schema: string, table: string, newName: string): string {
  return isMysql(driver)
    ? `RENAME TABLE ${table} TO ${qualifiedName(driver, schema, newName)};`
    : `ALTER TABLE ${table} RENAME TO ${quoteIdent(driver, newName)};`;
}

export function dropTableSql(table: string): string {
  return `DROP TABLE ${table};`;
}

/** SQLite qualifies the index name and wants a bare table name; the others qualify the table. */
export function addIndexSql(
  driver: QuoteDriver,
  schema: string,
  table: string,
  idx: { name: string; columns: string[]; unique: boolean },
): string {
  const cols = idx.columns.map((c) => quoteIdent(driver, c)).join(", ");
  const sqlite = driver === "sqlite";
  const name = sqlite ? qualifiedName(driver, schema, idx.name) : quoteIdent(driver, idx.name);
  const on = sqlite ? quoteIdent(driver, table) : qualifiedName(driver, schema, table);
  return `CREATE ${idx.unique ? "UNIQUE " : ""}INDEX ${name} ON ${on} (${cols});`;
}

/**
 * Index names are schema-scoped on Postgres/SQLite but table-scoped on MySQL. An index that backs a constraint
 * cannot be dropped directly: SQLite's autoindexes need a table rebuild, Postgres needs DROP CONSTRAINT.
 */
// ponytail: whether a Postgres unique index is constraint-backed (pg_constraint.conindid) is not introspected,
// so the DROP CONSTRAINT alternative is offered as a comment. Add `constraint: bool` to IndexInfo to pick one.
export function dropIndexSql(
  driver: QuoteDriver,
  schema: string,
  table: string,
  idx: { name: string; unique: boolean },
): string {
  if (isMysql(driver)) return `DROP INDEX ${quoteIdent(driver, idx.name)} ON ${table};`;
  if (driver === "sqlite" && idx.name.startsWith("sqlite_autoindex_"))
    return comment(`${idx.name} backs a UNIQUE or PRIMARY KEY constraint; rebuild the table to remove it.`);
  const drop = `DROP INDEX ${qualifiedName(driver, schema, idx.name)};`;
  if (driver === "sqlite" || !idx.unique) return drop;
  return [
    comment("If this index backs a UNIQUE constraint, DROP INDEX fails; drop the constraint instead:"),
    comment(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(driver, idx.name)};`),
    drop,
  ].join("\n");
}

export function dropForeignKeySql(driver: QuoteDriver, table: string, name: string): string {
  if (driver === "sqlite") return comment("SQLite cannot drop a foreign key; rebuild the table without it.");
  const kw = isMysql(driver) ? "FOREIGN KEY" : "CONSTRAINT";
  return `ALTER TABLE ${table} DROP ${kw} ${quoteIdent(driver, name)};`;
}
