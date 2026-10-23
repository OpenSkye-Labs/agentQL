/** One collator for every comparison: building one per `localeCompare(…, { numeric })` call made a 200k-row text
 * sort take seconds. */
const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * Row indices of `rows` ordered by `column`: numbers by value, everything else by its text in natural order
 * (`b2` before `b10`), NULLs last in both directions, stable for equal keys. `text` renders a non-number cell
 * (the grid passes `cellText`); each cell's text is computed once, not per comparison.
 */
export function sortOrder(
  rows: unknown[][],
  column: number,
  desc: boolean,
  text: (v: unknown) => string = (v) => String(v),
): number[] {
  const vals = rows.map((r) => r[column]);
  const keys = vals.map((v) => (v === null ? "" : typeof v === "number" ? String(v) : text(v)));
  const idx = vals.map((_, i) => i);
  idx.sort((a, b) => {
    const va = vals[a];
    const vb = vals[b];
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    const r = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(keys[a], keys[b]);
    return desc ? -r : r;
  });
  return idx;
}
