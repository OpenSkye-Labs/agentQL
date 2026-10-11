import { MAX_QUERY_VERSIONS, type SavedQuery } from "./types.ts";

/** The saved query to store: when `prev` exists and its text differs, it becomes the newest version. */
export function withVersion(prev: SavedQuery | undefined, q: SavedQuery, now = new Date().toISOString()): SavedQuery {
  const versions =
    prev && prev.sql !== q.sql
      ? [{ sql: prev.sql, ts: prev.updated_at ?? prev.created_at }, ...(prev.versions ?? [])].slice(
          0,
          MAX_QUERY_VERSIONS,
        )
      : (prev?.versions ?? q.versions ?? []);
  return { ...q, updated_at: now, versions };
}
