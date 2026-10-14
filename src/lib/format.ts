import type { Cell } from "./types";

export function isBytes(v: Cell): v is { $bytes: string; len: number } {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$bytes" in v;
}

/** Short single-line rendering for grid cells. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isBytes(v)) return `<${v.len} bytes>`;
  return JSON.stringify(v);
}

/** Grid rendering: like `cellText`, but long numeric arrays (embeddings) collapse to their dimension and head. */
export function cellPreview(v: Cell): string {
  if (Array.isArray(v) && v.length > 16 && v.every((x) => typeof x === "number")) {
    return `[${v.length} dims] ${v.slice(0, 4).join(", ")}, …`;
  }
  return cellText(v);
}

/** Full rendering for inspectors / editors. */
export function cellFull(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isBytes(v)) return `base64:${v.$bytes}`;
  return JSON.stringify(v, null, 2);
}

/** Parse what the user typed in a cell editor back into a JSON value using the column type as a hint. */
export function parseCell(text: string, typeName: string, original: Cell): Cell {
  const t = typeName.toUpperCase();
  if (text === "") return typeof original === "string" ? "" : null;
  if (/INT|SERIAL|NUMERIC|DECIMAL|FLOAT|DOUBLE|REAL|NUMBER|MONEY/.test(t) && /^-?\d+(\.\d+)?$/.test(text)) {
    return /INT|SERIAL/.test(t) && Number.isSafeInteger(Number(text))
      ? Number(text)
      : text.includes(".") || !Number.isSafeInteger(Number(text))
        ? text
        : Number(text);
  }
  if (/BOOL/.test(t)) {
    if (/^(true|t|1|yes)$/i.test(text)) return true;
    if (/^(false|f|0|no)$/i.test(text)) return false;
  }
  if (/JSON/.test(t) || typeof original === "object") {
    try {
      return JSON.parse(text);
    } catch {
      /* keep as string */
    }
  }
  return text;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? "⌘" : "Ctrl";
