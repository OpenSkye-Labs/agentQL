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

/** Quote an identifier unless it is plain lowercase; `q` is the dialect's quote character.
 *  ponytail: reserved words (a table named `order`) stay unquoted; add a keyword set if it bites. */
export function ident(name: string, q: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `${q}${name.split(q).join(q + q)}${q}`;
}

/** Tables (bare and schema-qualified) with their columns for lang-sql's schema completion.
 *  Table names are namespace keys, which lang-sql quotes itself; column objects need an explicit quoted `apply`. */
export function buildNamespace(tables: Record<string, TableInfo[]>, catalog: Catalogs, q = '"'): SQLNamespace {
  const ns: SQLNamespace = {};
  for (const [schema, list] of Object.entries(tables)) {
    const cols = new Map<string, Completion[]>();
    for (const c of catalog[schema]?.columns ?? []) {
      let arr = cols.get(c.table);
      if (!arr) cols.set(c.table, (arr = []));
      const apply = ident(c.name, q);
      arr.push({ label: c.name, type: "property", detail: c.data_type, ...(apply !== c.name && { apply }) });
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

const NOT_ALIAS =
  "where on join left right inner outer cross full natural group order having limit offset union set using as select returning window fetch for values with lateral except intersect straight_join";
const unq = (s: string) => s.replace(/^["`]|["`]$/g, "");
const ID = '["`]?[\\w$]+["`]?';
// `FROM t [AS] alias`: the alias group refuses clause keywords so `FROM orders JOIN x` leaves `JOIN` to the next match.
const REF_RE = new RegExp(
  `\\b(?:from|join)\\s+((?:${ID}\\s*\\.\\s*)?${ID})(?:\\s+(?:as\\s+)?(?!(?:${NOT_ALIAS.split(" ").join("|")})\\b)(${ID}))?`,
  "gi",
);

/** FROM/JOIN sources of a statement with their alias as written (the table name, quotes included, when none). */
export function tableRefs(stmt: string): TableRef[] {
  const refs: TableRef[] = [];
  for (const m of stmt.matchAll(REF_RE)) {
    const raw = m[1].split(".").map((p) => p.trim());
    refs.push({
      schema: raw.length > 1 ? unq(raw[0]) : null,
      table: unq(raw[raw.length - 1]),
      alias: m[2] ?? raw[raw.length - 1],
    });
  }
  return refs;
}

/** `JOIN other o ON o.id = t.other_id` options for every FK touching a table already in the statement. */
export function joinSuggestions(stmt: string, catalog: Catalogs, q = '"'): Completion[] {
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
    // A schema-qualified source is probably outside the search path, so qualify its join targets too.
    const qualified = (schema: string, table: string, from: string) =>
      r.schema || schema !== from ? `${ident(schema, q)}.${ident(table, q)}` : ident(table, q);
    for (const [schema, cat] of Object.entries(catalog)) {
      for (const fk of cat.foreign_keys) {
        const refSchema = fk.ref_schema ?? schema;
        if (fk.table === r.table && (!r.schema || r.schema === schema)) {
          // forward: r.col → ref_table.ref_col
          const a = aliasFor(fk.ref_table);
          const on = fk.columns
            .map((c, i) => `${a}.${ident(fk.ref_columns[i], q)} = ${r.alias}.${ident(c, q)}`)
            .join(" AND ");
          push(qualified(refSchema, fk.ref_table, schema), a, on, `${r.table}.${fk.columns.join(",")} →`);
        } else if (fk.ref_table === r.table && (!r.schema || refSchema === r.schema)) {
          // reverse: other.col → r.ref_col (the other table may live in another schema)
          const a = aliasFor(fk.table);
          const on = fk.columns
            .map((c, i) => `${a}.${ident(c, q)} = ${r.alias}.${ident(fk.ref_columns[i], q)}`)
            .join(" AND ");
          push(qualified(schema, fk.table, refSchema), a, on, `← ${fk.table}.${fk.columns.join(",")}`);
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

/** Only numbered placeholders (`${1}`, `${2:name}`) mark a saved query as a snippet; `'${HOME}'` stays literal SQL. */
export const isSnippet = (sql: string) => /\$\{\d+(?::[^}]*)?\}/.test(sql);

/** Escape `${name}` / `#{name}` that are not numbered Tab stops so the snippet parser leaves them literal. */
export const snippetTemplate = (sql: string) =>
  sql.replace(/([$#])\{(?!\d+(?::[^}]*)?\})([^}]*)\}/g, (_, sigil: string, body: string) => `${sigil}\\{${body}\\}`);

export interface CompletionDeps {
  catalog: () => Catalogs;
  /** Snippet completions for saved queries that have a trigger word. */
  snippets: () => Completion[];
  postgres: () => boolean;
  /** Identifier quote character of the dialect: `"` or `` ` ``. */
  quote: () => string;
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
      ? joinSuggestions(doc.slice(start, word.to), deps.catalog(), deps.quote())
      : [
          ...contextKeywords(before, deps.postgres()).map((label) => ({ label, type: "keyword", boost: 1 })),
          ...deps.snippets(),
        ];
    return options.length ? { from: word.from, options, validFor: /^[\w$]*$/ } : null;
  };
}
