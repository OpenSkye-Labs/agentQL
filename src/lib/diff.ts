export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff via LCS. DDL is tens of lines, so O(n·m) is fine. */
// ponytail: quadratic LCS; swap in Myers if someone diffs multi-thousand-line objects.
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a ? a.split("\n") : [];
  const B = b ? b.split("\n") : [];
  const n = A.length;
  const m = B.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: "same", text: A[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: A[i++] });
    else out.push({ kind: "add", text: B[j++] });
  }
  while (i < n) out.push({ kind: "del", text: A[i++] });
  while (j < m) out.push({ kind: "add", text: B[j++] });
  return out;
}

/** Unified-diff style text (`-`/`+`/` ` prefixes) for the clipboard. */
export function formatDiff(lines: DiffLine[]): string {
  return lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}`).join("\n");
}
