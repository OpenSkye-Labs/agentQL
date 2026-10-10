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
  const parts = (ddl ?? "").split(/('(?:[^']|'')*')/);
  const s = parts
    .map((part, i) => {
      // Inside a literal only a regclass reference ('a.t_id_seq'::regclass, Postgres serial defaults) is schema noise.
      if (i % 2)
        return esc && parts[i + 1]?.startsWith("::regclass") ? part.replace(new RegExp(`^'${esc}\\.`), "'") : part;
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

const isMysql = (driver: QuoteDriver) => driver === "mysql" || driver === "mariadb";
// MySQL reports string defaults unquoted. Only a strict allow-list (or MySQL 8's DEFAULT_GENERATED flag) is
// emitted verbatim; everything else is quoted so a default from the other database can never become code.
const isExpression = (c: ColumnInfo) =>
  /DEFAULT_GENERATED/i.test(c.extra ?? "") ||
  /^(-?\d+(\.\d+)?|NULL|CURRENT_(TIMESTAMP|DATE|TIME)(\(\d*\))?|b'[01]+')$/i.test(c.default ?? "");

/** Keep names and DDL from the other database on one comment line: no CR/LF, no comment terminator. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /");

function columnDef(driver: QuoteDriver, c: ColumnInfo) {
  let s = `${quoteIdent(driver, c.name)} ${c.data_type}`;
  if (!c.nullable) s += " NOT NULL";
  if (c.default != null)
    s += ` DEFAULT ${isMysql(driver) && !isExpression(c) ? `'${c.default.replace(/'/g, "''")}'` : c.default}`;
  if (c.extra) s += /auto_increment/i.test(c.extra) ? " AUTO_INCREMENT" : ` /* ${oneLine(c.extra)} */`;
  return s;
}

const comment = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map((l) => `-- ${oneLine(l)}`)
    .join("\n");

type Qualify = (name: string, schema?: string | null) => string;

/** CREATE TABLE synthesised from the introspected metadata (mirrors Rust `synth_ddl`), quoted for the destination driver. */
function createTable(driver: QuoteDriver, qualify: Qualify, o: SchemaObject) {
  const d = o.details;
  const q = (c: string) => quoteIdent(driver, c);
  const lines = d.columns.map((c) => `  ${columnDef(driver, c)}`);
  const pk = d.indexes.find((i) => i.primary)?.columns ?? d.columns.filter((c) => c.is_primary).map((c) => c.name);
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(q).join(", ")})`);
  const extra = d.indexes.filter((i) => !i.primary).map((i) => oneLine(`-- index ${i.name} (${i.columns.join(", ")})`));
  return [`CREATE TABLE ${qualify(o.table.name)} (\n${lines.join(",\n")}\n);`, ...extra].join("\n");
}

/** Foreign keys are added after every table exists, so creation order and cycles do not matter. */
function addForeignKeys(driver: QuoteDriver, qualify: Qualify, o: SchemaObject) {
  const q = (c: string) => quoteIdent(driver, c);
  return o.details.foreign_keys.map(
    (f) =>
      `ALTER TABLE ${qualify(o.table.name)} ADD CONSTRAINT ${q(f.name)} FOREIGN KEY (${f.columns.map(q).join(", ")}) ` +
      `REFERENCES ${qualify(f.ref_table, f.ref_schema !== o.table.schema ? f.ref_schema : null)} (${f.ref_columns.map(q).join(", ")});`,
  );
}

/**
 * SQL that moves schema A (the source, where the script runs) towards schema B.
 * CREATE/DROP for whole objects and ADD/DROP COLUMN for changed tables; everything else is a comment to review.
 */
// ponytail: no ALTER COLUMN / index / FK statements (syntax differs per driver); they are listed as comments.
export function migrationSql(driver: QuoteDriver, schema: string, diffs: ObjectDiff[]): string {
  // Objects of the compared schema land in A's schema; references into other schemas keep their own.
  const qualified: Qualify = (name, other) => {
    const s = other ?? schema;
    return driver === "sqlite" && s === "main"
      ? quoteIdent(driver, name)
      : `${quoteIdent(driver, s)}.${quoteIdent(driver, name)}`;
  };
  const out: string[] = [];
  const fks: string[] = [];
  for (const d of diffs) {
    if (d.status === "same") continue;
    const t = qualified(d.name);
    const name = oneLine(d.name);
    const isTable = d.kind === "table";
    if (d.status === "added") {
      if (isTable) {
        out.push(`-- create ${name}`, createTable(driver, qualified, d.right!));
        fks.push(...addForeignKeys(driver, qualified, d.right!));
      } else out.push(`-- create ${d.kind} ${name}; definition on B:`, comment(d.rightDdl || "(no DDL available)"));
    } else if (d.status === "removed") {
      const what =
        d.kind === "matview"
          ? "MATERIALIZED VIEW"
          : d.kind === "view"
            ? "VIEW"
            : d.kind === "foreign"
              ? "FOREIGN TABLE"
              : "TABLE";
      out.push(`DROP ${what} ${t};`);
    } else if (!isTable) {
      out.push(`-- ${d.kind} ${name} differs; definition on B:`, comment(d.rightDdl || "(no DDL available)"));
    } else {
      const lc = new Map(d.left!.details.columns.map((c) => [c.name, c]));
      const rc = new Map(d.right!.details.columns.map((c) => [c.name, c]));
      const lines: string[] = [`-- alter ${name}`];
      for (const [name, c] of rc) if (!lc.has(name)) lines.push(`ALTER TABLE ${t} ADD COLUMN ${columnDef(driver, c)};`);
      for (const name of lc.keys())
        if (!rc.has(name)) lines.push(`ALTER TABLE ${t} DROP COLUMN ${quoteIdent(driver, name)};`);
      for (const [name, b] of rc) {
        const a = lc.get(name);
        if (!a) continue;
        const sameDefault =
          normaliseDdl(a.default, d.left!.table.schema) === normaliseDdl(b.default, d.right!.table.schema);
        if (a.data_type !== b.data_type || a.nullable !== b.nullable || !sameDefault)
          lines.push(oneLine(`-- column ${name}: ${columnDef(driver, a)}  ->  ${columnDef(driver, b)}`));
      }
      const li = new Set(d.left!.details.indexes.map((i) => i.name));
      const ri = new Set(d.right!.details.indexes.map((i) => i.name));
      for (const i of d.right!.details.indexes)
        if (!li.has(i.name)) lines.push(oneLine(`-- index ${i.name} added (${i.columns.join(", ")})`));
      for (const i of d.left!.details.indexes) if (!ri.has(i.name)) lines.push(oneLine(`-- index ${i.name} removed`));
      const lf = new Set(d.left!.details.foreign_keys.map((f) => f.name));
      const rf = new Set(d.right!.details.foreign_keys.map((f) => f.name));
      for (const f of d.right!.details.foreign_keys)
        if (!lf.has(f.name)) lines.push(oneLine(`-- foreign key ${f.name} added`));
      for (const f of d.left!.details.foreign_keys)
        if (!rf.has(f.name)) lines.push(oneLine(`-- foreign key ${f.name} removed`));
      if (lines.length === 1) lines.push(`-- DDL differs; review manually`);
      out.push(...lines);
    }
    out.push("");
  }
  if (fks.length) out.push("-- foreign keys of created tables", ...fks, "");
  return out.join("\n").trim() + (out.length ? "\n" : "");
}
