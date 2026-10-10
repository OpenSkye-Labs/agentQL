/**
 * Editor completion on top of @codemirror/lang-sql. lang-sql already resolves `FROM orders o` → `o.` when the
 * namespace carries columns, so this module only (1) builds that namespace from the schema catalog, (2) suggests
 * JOINs from foreign keys and (3) ranks the keywords that make sense after the current clause.
 * ponytail: regex clause parsing, no subqueries/CTEs; swap for the lezer tree if it ever misleads.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { SchemaCatalog, TableInfo } from "./types";
import { statementStart } from "./sql.ts";

export type Catalogs = Record<string, SchemaCatalog>;

const escapeDots = (s: string) => s.replace(/\./g, "\\.");

/** Tables (bare and schema-qualified) with their columns for lang-sql's schema completion. */
export function buildNamespace(tables: Record<string, TableInfo[]>, catalog: Catalogs): SQLNamespace {
  const ns: SQLNamespace = {};
  for (const [schema, list] of Object.entries(tables)) {
    const cols = new Map<string, Completion[]>();
    for (const c of catalog[schema]?.columns ?? []) {
      let arr = cols.get(c.table);
      if (!arr) cols.set(c.table, (arr = []));
      arr.push({ label: c.name, type: "property", detail: c.data_type });
    }
    for (const t of list) {
      const entry = cols.get(t.name) ?? [];
      ns[escapeDots(t.name)] = entry;
      ns[`${escapeDots(schema)}.${escapeDots(t.name)}`] = entry;
    }
  }
  return ns;
}

export interface TableRef {
  schema: string | null;
  table: string;
  alias: string;
}

const NOT_ALIAS = new Set(
  "where on join left right inner outer cross full natural group order having limit offset union set using as select returning window fetch for values with lateral except intersect straight_join".split(
    " ",
  ),
);
const unq = (s: string) => s.replace(/^["`]|["`]$/g, "");

/** FROM/JOIN sources of a statement with their alias (the table name when none). */
export function tableRefs(stmt: string): TableRef[] {
  const refs: TableRef[] = [];
  const re = /\b(?:from|join)\s+((?:["`]?[\w$]+["`]?\s*\.\s*)?["`]?[\w$]+["`]?)(?:\s+(?:as\s+)?(["`]?[\w$]+["`]?))?/gi;
  for (const m of stmt.matchAll(re)) {
    const parts = m[1].split(".").map((p) => unq(p.trim()));
    const table = parts.pop()!;
    let alias = m[2] ? unq(m[2]) : table;
    if (NOT_ALIAS.has(alias.toLowerCase())) alias = table;
    refs.push({ schema: parts[0] ?? null, table, alias });
  }
  return refs;
}

/** `JOIN other o ON o.id = t.other_id` options for every FK touching a table already in the statement. */
export function joinSuggestions(stmt: string, catalog: Catalogs): Completion[] {
  const refs = tableRefs(stmt);
  if (!refs.length) return [];
  const used = new Set(refs.map((r) => r.alias.toLowerCase()));
  const aliasFor = (table: string) => {
    const base = table.replace(/[^a-z]/gi, "")[0]?.toLowerCase() ?? "t";
    let a = base;
    for (let n = 2; used.has(a); n++) a = `${base}${n}`;
    return a;
  };
  const out: Completion[] = [];
  const seen = new Set<string>();
  const push = (table: string, alias: string, on: string, detail: string) => {
    const label = `${table} ${alias} ON ${on}`;
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ label, type: "type", detail, boost: 2 });
  };
  for (const r of refs) {
    for (const [schema, cat] of Object.entries(catalog)) {
      if (r.schema && r.schema !== schema) continue;
      for (const fk of cat.foreign_keys) {
        if (fk.table === r.table) {
          const ref = fk.ref_schema && fk.ref_schema !== schema ? `${fk.ref_schema}.${fk.ref_table}` : fk.ref_table;
          const a = aliasFor(fk.ref_table);
          const on = fk.columns.map((c, i) => `${a}.${fk.ref_columns[i]} = ${r.alias}.${c}`).join(" AND ");
          push(ref, a, on, `${r.table}.${fk.columns.join(",")} →`);
        } else if (fk.ref_table === r.table && (!r.schema || (fk.ref_schema ?? schema) === r.schema)) {
          const a = aliasFor(fk.table);
          const on = fk.columns.map((c, i) => `${a}.${c} = ${r.alias}.${fk.ref_columns[i]}`).join(" AND ");
          push(fk.table, a, on, `← ${fk.table}.${fk.columns.join(",")}`);
        }
      }
    }
  }
  return out;
}

const CLAUSE =
  /\b(select|delete\s+from|insert\s+into|from|join|where|group\s+by|order\s+by|having|limit|update|set|values|on)\b/gi;

/** Keywords that make sense after the last clause keyword in `before` (statement text up to the cursor). */
export function contextKeywords(before: string, postgres = false): string[] {
  const clauses = [...before.matchAll(CLAUSE)].map((m) => m[1].toLowerCase().replace(/\s+/g, " "));
  const pg = (...k: string[]) => (postgres ? k : []);
  switch (clauses.at(-1)) {
    case undefined:
      return ["SELECT", "INSERT INTO", "UPDATE", "DELETE FROM", "WITH", "CREATE TABLE", "ALTER TABLE", "EXPLAIN"];
    case "select":
      return ["FROM", "DISTINCT", "AS", "COUNT(*)", "CASE"];
    case "from":
    case "join":
    case "on":
      return ["WHERE", "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "GROUP BY", "ORDER BY", "LIMIT", "AS"];
    case "where":
    case "having":
      return [
        "AND",
        "OR",
        "NOT",
        "IN",
        "LIKE",
        ...pg("ILIKE"),
        "IS NULL",
        "IS NOT NULL",
        "BETWEEN",
        "EXISTS",
        "GROUP BY",
        "ORDER BY",
        "LIMIT",
      ];
    case "group by":
      return ["HAVING", "ORDER BY", "LIMIT"];
    case "order by":
      return ["ASC", "DESC", "LIMIT", ...pg("NULLS LAST", "NULLS FIRST")];
    case "limit":
      return ["OFFSET"];
    case "update":
      return ["SET"];
    case "set":
      return ["WHERE", ...pg("RETURNING")];
    case "insert into":
      return ["VALUES", "SELECT"];
    case "values":
      return pg("RETURNING", "ON CONFLICT");
    case "delete from":
      return ["WHERE", "USING", ...pg("RETURNING")];
    default:
      return [];
  }
}

export interface CompletionDeps {
  catalog: () => Catalogs;
  /** Snippet completions for saved queries that have a trigger word. */
  snippets: () => Completion[];
  postgres: () => boolean;
}

/** Extra completion source merged with lang-sql's schema/keyword completion. */
export function editorCompletions(deps: CompletionDeps) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const doc = ctx.state.doc.toString();
    const start = statementStart(doc, word.from);
    const before = doc.slice(start, word.from);
    if (/\.\s*$/.test(before)) return null; // `alias.` → lang-sql lists the columns
    const options: Completion[] = /\bjoin\s+$/i.test(before)
      ? joinSuggestions(doc.slice(start, word.to), deps.catalog())
      : [
          ...contextKeywords(before, deps.postgres()).map((label) => ({ label, type: "keyword", boost: 1 })),
          ...deps.snippets(),
        ];
    return options.length ? { from: word.from, options, validFor: /^[\w$]*$/ } : null;
  };
}
