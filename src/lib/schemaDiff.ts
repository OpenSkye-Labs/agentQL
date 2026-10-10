import type { ColumnInfo, SchemaObject } from "./types.ts";
import { quoteIdent, type QuoteDriver } from "./sql.ts";

export type DiffStatus = "added" | "removed" | "changed" | "same";

export interface ObjectDiff {
  name: string;
  kind: string;
  status: DiffStatus;
  left: SchemaObject | null;
  right: SchemaObject | null;
  leftDdl: string;
  rightDdl: string;
}

/** DDL with the noise stripped so two dumps of the same object compare equal across schemas. */
export function normaliseDdl(ddl: string | null, schema?: string): string {
  const esc = schema?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Only touch code outside '…' literals so defaults like 'a.example' keep their meaning.
  const s = (ddl ?? "")
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => {
      if (i % 2) return part;
      let code = part.replace(/\sAUTO_INCREMENT=\d+/g, ""); // MySQL counter, changes with every insert
      // Drop the object's own schema qualification ("public"., `app`., public.) so a.t and b.t line up.
      if (esc) code = code.replace(new RegExp(`(?<![\\w"\`])(?:"${esc}"|\`${esc}\`|${esc})\\.`, "g"), "");
      return code;
    })
    .join("");
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Match objects by name; "added" means it only exists on the right (the target). */
export function compareSchemas(left: SchemaObject[], right: SchemaObject[]): ObjectDiff[] {
  const names = new Set([...left, ...right].map((o) => o.table.name));
  const l = new Map(left.map((o) => [o.table.name, o]));
  const r = new Map(right.map((o) => [o.table.name, o]));
  return [...names].sort().map((name) => {
    const a = l.get(name) ?? null;
    const b = r.get(name) ?? null;
    const leftDdl = normaliseDdl(a?.details.ddl ?? null, a?.table.schema);
    const rightDdl = normaliseDdl(b?.details.ddl ?? null, b?.table.schema);
    const status: DiffStatus = !a ? "added" : !b ? "removed" : leftDdl === rightDdl ? "same" : "changed";
    return { name, kind: (b ?? a)!.table.kind, status, left: a, right: b, leftDdl, rightDdl };
  });
}

const MYSQL = (driver: QuoteDriver) => driver === "mysql" || driver === "mariadb";
// ponytail: MySQL reports string defaults unquoted; treat anything that is not a number/keyword/call as a literal.
const isExpression = (d: string) =>
  /^(-?\d+(\.\d+)?|NULL|CURRENT_(TIMESTAMP|DATE|TIME)(\(\d*\))?|b'[01]+'|[\w.]+\(.*\)|\(.*\))$/i.test(d);

function columnDef(driver: QuoteDriver, c: ColumnInfo) {
  let s = `${quoteIdent(driver, c.name)} ${c.data_type}`;
  if (!c.nullable) s += " NOT NULL";
  if (c.default != null)
    s += ` DEFAULT ${MYSQL(driver) && !isExpression(c.default) ? `'${c.default.replace(/'/g, "''")}'` : c.default}`;
  if (c.extra) s += /auto_increment/i.test(c.extra) ? " AUTO_INCREMENT" : ` /* ${c.extra} */`;
  return s;
}

const comment = (text: string) =>
  text
    .split("\n")
    .map((l) => `-- ${l}`)
    .join("\n");

/** CREATE TABLE synthesised from the introspected metadata, quoted for the destination driver. */
function createTable(driver: QuoteDriver, qualified: string, o: SchemaObject) {
  const d = o.details;
  const lines = d.columns.map((c) => `  ${columnDef(driver, c)}`);
  const pk = d.indexes.find((i) => i.primary)?.columns ?? d.columns.filter((c) => c.is_primary).map((c) => c.name);
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map((c) => quoteIdent(driver, c)).join(", ")})`);
  return `CREATE TABLE ${qualified} (\n${lines.join(",\n")}\n);`;
}

/**
 * SQL that moves schema A (the source, where the script runs) towards schema B.
 * CREATE/DROP for whole objects and ADD/DROP COLUMN for changed tables; everything else is a comment to review.
 */
// ponytail: no ALTER COLUMN / index / FK statements (syntax differs per driver); they are listed as comments.
export function migrationSql(driver: QuoteDriver, schema: string, diffs: ObjectDiff[]): string {
  const qualified = (name: string) =>
    driver === "sqlite" && schema === "main"
      ? quoteIdent(driver, name)
      : `${quoteIdent(driver, schema)}.${quoteIdent(driver, name)}`;
  const out: string[] = [];
  for (const d of diffs) {
    if (d.status === "same") continue;
    const t = qualified(d.name);
    const isTable = d.kind === "table";
    if (d.status === "added") {
      if (isTable) out.push(`-- create ${d.name}`, createTable(driver, t, d.right!));
      else out.push(`-- create ${d.kind} ${d.name}; definition on B:`, comment(d.rightDdl || "(no DDL available)"));
    } else if (d.status === "removed") {
      const what = d.kind === "matview" ? "MATERIALIZED VIEW" : d.kind === "view" ? "VIEW" : "TABLE";
      out.push(`DROP ${what} ${t};`);
    } else if (!isTable) {
      out.push(`-- ${d.kind} ${d.name} differs; definition on B:`, comment(d.rightDdl || "(no DDL available)"));
    } else {
      const lc = new Map(d.left!.details.columns.map((c) => [c.name, c]));
      const rc = new Map(d.right!.details.columns.map((c) => [c.name, c]));
      const lines: string[] = [`-- alter ${d.name}`];
      for (const [name, c] of rc) if (!lc.has(name)) lines.push(`ALTER TABLE ${t} ADD COLUMN ${columnDef(driver, c)};`);
      for (const name of lc.keys())
        if (!rc.has(name)) lines.push(`ALTER TABLE ${t} DROP COLUMN ${quoteIdent(driver, name)};`);
      for (const [name, b] of rc) {
        const a = lc.get(name);
        if (!a) continue;
        if (a.data_type !== b.data_type || a.nullable !== b.nullable || (a.default ?? null) !== (b.default ?? null))
          lines.push(`-- column ${name}: ${columnDef(driver, a)}  ->  ${columnDef(driver, b)}`);
      }
      const li = new Set(d.left!.details.indexes.map((i) => i.name));
      const ri = new Set(d.right!.details.indexes.map((i) => i.name));
      for (const i of d.right!.details.indexes)
        if (!li.has(i.name)) lines.push(`-- index ${i.name} added (${i.columns.join(", ")})`);
      for (const i of d.left!.details.indexes) if (!ri.has(i.name)) lines.push(`-- index ${i.name} removed`);
      const lf = new Set(d.left!.details.foreign_keys.map((f) => f.name));
      const rf = new Set(d.right!.details.foreign_keys.map((f) => f.name));
      for (const f of d.right!.details.foreign_keys) if (!lf.has(f.name)) lines.push(`-- foreign key ${f.name} added`);
      for (const f of d.left!.details.foreign_keys) if (!rf.has(f.name)) lines.push(`-- foreign key ${f.name} removed`);
      if (lines.length === 1) lines.push(`-- DDL differs; review manually`);
      out.push(...lines);
    }
    out.push("");
  }
  return out.join("\n").trim() + (out.length ? "\n" : "");
}
