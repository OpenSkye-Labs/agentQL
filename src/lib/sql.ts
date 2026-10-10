/** Find the `;`-delimited statement containing `pos` (ignores quotes/comments reasonably). */
export function statementAt(doc: string, pos: number): string {
  const bounds: number[] = [0];
  let i = 0;
  let quote: string | null = null;
  while (i < doc.length) {
    const c = doc[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\") i++;
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "-" && doc[i + 1] === "-") {
      while (i < doc.length && doc[i] !== "\n") i++;
    } else if (c === "/" && doc[i + 1] === "*") {
      const end = doc.indexOf("*/", i + 2);
      i = end === -1 ? doc.length : end + 1;
    } else if (c === ";") bounds.push(i + 1);
    i++;
  }
  bounds.push(doc.length);
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b];
    const end = bounds[b + 1];
    if (pos >= start && pos <= end) {
      const text = doc.slice(start, end).trim();
      if (text) return text.replace(/;$/, "");
      // cursor right after a ';' on blank space → previous statement
      if (b > 0)
        return doc
          .slice(bounds[b - 1], start)
          .trim()
          .replace(/;$/, "");
    }
  }
  return doc.trim();
}

export type QuoteDriver = "postgres" | "mysql" | "mariadb" | "sqlite" | string;

/** Quote an identifier the way the driver expects (mirrors `SqlConn::quote_ident`). */
export function quoteIdent(driver: QuoteDriver, name: string): string {
  return driver === "mysql" || driver === "mariadb"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/** Render a grid cell as a SQL literal for a WHERE clause (strings, numbers, booleans; others as text). */
export function sqlLiteral(driver: QuoteDriver, v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `'${v}'`;
  if (typeof v === "boolean") return driver === "sqlite" ? (v ? "1" : "0") : v ? "TRUE" : "FALSE";
  if (typeof v === "object" && "$bytes" in v && typeof v.$bytes === "string") {
    const b64 = v.$bytes.replace(/[^A-Za-z0-9+/=]/g, "");
    if (driver === "postgres") return `decode('${b64}', 'base64')`;
    if (driver === "mysql" || driver === "mariadb") return `FROM_BASE64('${b64}')`;
    const hex = Array.from(atob(b64), (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `X'${hex}'`;
  }
  // ponytail: arrays/objects compare as their JSON text; Postgres array keys would need `'{…}'` syntax.
  const s = typeof v === "string" ? v : JSON.stringify(v);
  let esc = s.replace(/'/g, "''");
  if (driver === "mysql" || driver === "mariadb") esc = esc.replace(/\\/g, "\\\\");
  return `'${esc}'`;
}

/** `"a" = 1 AND "b" = 'x'` for an FK jump; null when any key part is NULL (no row can match). */
export function keyFilter(driver: QuoteDriver, key: Record<string, unknown>): string | null {
  const parts = Object.entries(key);
  if (parts.length === 0 || parts.some(([, v]) => v === null || v === undefined)) return null;
  return parts.map(([c, v]) => `${quoteIdent(driver, c)} = ${sqlLiteral(driver, v)}`).join(" AND ");
}
