import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errMsg } from "./api";
import { useStore } from "./store";
import type { Note } from "./types";

/** The note kinds in display order: table note, column notes, metrics. */
export const noteRank = (n: Note) => (n.column ? 1 : n.metric ? 2 : 0);

/**
 * A connection's data-dictionary notes, reloaded whenever a writer (this UI or the agent's `save_note`)
 * emits `notes:changed`. `notes` is null until the first load.
 */
export function useNotes(connectionId: string) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may land: a slow older response must not overwrite a newer list.
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    api.notesList(connectionId).then(
      (list) => {
        if (n !== seq.current) return;
        setNotes(list);
        setError(null);
      },
      (e) => {
        if (n === seq.current) setError(errMsg(e));
      },
    );
  }, [connectionId]);
  useEffect(() => {
    let active = true;
    const un = listen<string>("notes:changed", ({ payload }) => {
      if (payload === connectionId) reload();
    });
    // First load once the listener is registered, so a save in between cannot be missed. Without the listener the
    // notes still load once, but would silently go stale: say so.
    un.then(
      () => {
        if (active) reload();
      },
      (e) => {
        if (!active) return;
        useStore.getState().toast(`Notes will not refresh automatically: ${errMsg(e)}`, "error");
        reload();
      },
    );
    return () => {
      active = false;
      seq.current++;
      void un.then(
        (f) => f(),
        () => undefined,
      );
    };
  }, [connectionId, reload]);
  return { notes, error };
}
