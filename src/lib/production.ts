import type { ConnectionConfig } from "./types";

/** Replace control characters so a name shown in a confirm prompt cannot fake extra lines. */
export const plain = (s: string) =>
  Array.from(s, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("");

/**
 * The confirmation text for writes on a production connection, one bullet per action, or null when there is
 * nothing to confirm (not production, or nothing writes). Callers pass actions already run through `plain`.
 */
export function productionPrompt(
  conn: Pick<ConnectionConfig, "name" | "environment">,
  actions: string[],
): string | null {
  if (conn.environment !== "production" || actions.length === 0) return null;
  return [`"${plain(conn.name)}" is tagged PRODUCTION. This will run:`, ...actions.map((a) => `  • ${a}`)].join("\n");
}

/** True when the write may go ahead: not production, or the user confirmed. */
export function confirmProduction(conn: Pick<ConnectionConfig, "name" | "environment">, actions: string[]): boolean {
  const prompt = productionPrompt(conn, actions);
  // ponytail: native confirm(), same as the other prompts; swap for <Dialog> if it needs styling.
  return prompt === null || confirm(prompt);
}
