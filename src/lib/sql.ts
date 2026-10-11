/** Offsets of `;`-delimited statement boundaries in `doc` (ignores quotes, dollar quotes and comments). */
function statementBounds(doc: string): number[] {
  const bounds: number[] = [0];
  let i = 0;
  let quote: string | null = null;
  while (i < doc.length) {
    const c = doc[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\") i++;
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "$") {
      // Postgres dollar quoting: $$ … $$ or $tag$ … $tag$ (same rule as the backend splitter)
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(doc.slice(i));
      // No closing tag (e.g. MySQL `$$` identifier): treat `$` as an ordinary character, like the backend.
      const end = m ? doc.indexOf(m[0], i + m[0].length) : -1;
      if (m && end !== -1) i = end + m[0].length - 1;
    } else if (c === "-" && doc[i + 1] === "-") {
      while (i < doc.length && doc[i] !== "\n") i++;
    } else if (c === "/" && doc[i + 1] === "*") {
      const end = doc.indexOf("*/", i + 2);
      i = end === -1 ? doc.length : end + 1;
    } else if (c === ";") bounds.push(i + 1);
    i++;
  }
  bounds.push(doc.length);
  return bounds;
}

/** Find the `;`-delimited statement containing `pos`. */
export function statementAt(doc: string, pos: number): string {
  const bounds = statementBounds(doc);
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

/** Number of non-empty statements in `doc`. */
// ponytail: comments-only chunks count as statements; fine for a "run all N?" prompt, use a lexer if it misleads.
export function countStatements(doc: string): number {
  const bounds = statementBounds(doc);
  return bounds.slice(0, -1).filter((start, b) =>
    doc
      .slice(start, bounds[b + 1])
      .replace(/;/g, "")
      .trim(),
  ).length;
}
