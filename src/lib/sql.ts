/** Offsets where `;`-delimited statements start/end (ignores quotes/comments reasonably). */
export function statementBounds(doc: string): number[] {
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
  return bounds;
}

/** Start offset of the statement containing `pos`. */
export function statementStart(doc: string, pos: number): number {
  const bounds = statementBounds(doc);
  let start = 0;
  for (const b of bounds.slice(0, -1)) if (b <= pos) start = b; // last entry is the doc-end sentinel
  return start;
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
