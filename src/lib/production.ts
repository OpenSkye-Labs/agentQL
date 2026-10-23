import type { ConnectionConfig } from "./types";

/** Replace control characters (C0, DEL, C1, U+2028/2029) and bidi formatting marks, so a name shown in a native
 * prompt can neither fake extra lines nor display reordered (U+202E) as something it is not. */
export const plain = (s: string) =>
  Array.from(s, (c) => {
    const n = c.charCodeAt(0);
    const bidi =
      n === 0x061c || n === 0x200e || n === 0x200f || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
    return n < 32 || (n >= 127 && n < 160) || n === 0x2028 || n === 0x2029 || bidi ? " " : c;
  }).join("");

const ARG_MAX = 80;

/** Arguments for display, each clipped with a visible length marker, so one long argument never hides the next. */
export const clipArgs = (args: string[]) =>
  args
    .map((a) => {
      const q = /\s|"/.test(a) ? JSON.stringify(a) : a;
      return q.length > ARG_MAX ? `${q.slice(0, ARG_MAX)}… (${a.length} chars)` : q;
    })
    .join(" ");

/**
 * The confirmation text for writes on a production connection, one bullet per action, or null when there is
 * nothing to confirm (not production, or nothing writes). Actions are sanitised here.
 */
export function productionPrompt(
  conn: Pick<ConnectionConfig, "name" | "environment">,
  actions: string[],
): string | null {
  if (conn.environment !== "production" || actions.length === 0) return null;
  return [`"${plain(conn.name)}" is tagged PRODUCTION. This will run:`, ...actions.map((a) => `  • ${plain(a)}`)].join(
    "\n",
  );
}

/**
 * True when the write may go ahead. On production the user confirms the actions; elsewhere `fallback`, if given,
 * is asked instead (e.g. "Delete this document?").
 */
export function confirmProduction(
  conn: Pick<ConnectionConfig, "name" | "environment">,
  actions: string[],
  fallback?: string,
): boolean {
  const prompt = productionPrompt(conn, actions);
  // ponytail: native confirm(), same as the other prompts; swap for <Dialog> if it needs styling.
  if (prompt !== null) return confirm(prompt);
  return fallback ? confirm(fallback) : true;
}
