import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, errMsg } from "./api";
import type {
  ChatSession,
  ConnectionConfig,
  Dashboard,
  HistoryEntry,
  SavedQuery,
  SchemaCatalog,
  Settings,
  TableInfo,
} from "./types";
import { withVersion } from "./queries";

export type Tab =
  | {
      id: string;
      kind: "query";
      connectionId: string;
      title: string;
      sql: string;
      pinned?: boolean;
      /** Saved query this tab was loaded from; "Save" updates it and records a version. */
      savedId?: string;
      /** On-disk .sql file this tab was opened from or saved to. */
      filePath?: string;
    }
  | {
      id: string;
      kind: "table";
      connectionId: string;
      title: string;
      schema: string;
      table: string;
      tableKind: string;
      /** WHERE clause body applied to the grid (set by FK jumps, kept in sync by the tab). */
      filter?: string;
      /** Unapplied grid edits exist (published by TableTab so a jump can ask before discarding them). */
      dirty?: boolean;
    }
  | { id: string; kind: "chat"; connectionId: string; title: string; sessionId: string }
  | { id: string; kind: "dashboard"; connectionId: string; title: string; dashboardId: string }
  | { id: string; kind: "redis"; connectionId: string; title: string }
  | { id: string; kind: "mongo"; connectionId: string; title: string; db: string; collection: string }
  | { id: string; kind: "erd"; connectionId: string; title: string; schema: string }
  | { id: string; kind: "diff"; connectionId: string; title: string; schema?: string }
  | { id: string; kind: "welcome"; connectionId: null; title: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewTab = DistributiveOmit<Tab, "id"> & { id?: string };

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export interface LiveConn {
  id: string;
  database: string;
  version: string | null;
  schemas: string[];
  tables: Record<string, TableInfo[]>; // by schema
  catalog: Record<string, SchemaCatalog>; // by schema, for editor completion
  databases: string[];
  expanded: Record<string, boolean>;
  loading?: boolean;
}

interface State {
  connections: ConnectionConfig[];
  live: Record<string, LiveConn>;
  tabs: Tab[];
  activeTab: string | null;
  settings: Settings;
  toasts: Toast[];
  dashboards: Dashboard[];
  savedQueries: SavedQuery[];
  history: HistoryEntry[];
  sidebarFilter: string;
  chatOpen: boolean;
  chatSessionId: string | null;
  /** Text queued for the assistant input (consumed by ChatPanel on mount or change). */
  chatPrefill: string | null;
  secretStorage: "keychain" | "file" | null;

  init: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  connect: (id: string, database?: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  loadTables: (connId: string, schema: string) => Promise<void>;
  refreshSchema: (connId: string) => Promise<void>;
  toggleSchema: (connId: string, schema: string) => void;

  openTab: (tab: NewTab) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;

  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  saveSettings: (s: Settings) => Promise<void>;

  saveDashboard: (d: Dashboard) => Promise<void>;
  deleteDashboard: (id: string) => Promise<void>;
  saveQuery: (q: SavedQuery) => Promise<void>;
  deleteSavedQuery: (id: string) => Promise<void>;
  addHistory: (h: HistoryEntry) => Promise<void>;
  clearHistory: () => Promise<void>;
  setSidebarFilter: (f: string) => void;
  setChatOpen: (open: boolean, sessionId?: string | null) => void;
  askAssistant: (prefill: string) => void;
  takeChatPrefill: () => string | null;
}

let tabSeq = 1;
let toastSeq = 1;
/** Latest catalog request per connection+schema, so a slow older response cannot overwrite a newer one. */
const catalogSeq = new Map<string, number>();
/** Drop every in-flight catalog response for a connection (refresh, disconnect). */
const invalidateCatalog = (connId: string) => {
  for (const [key, n] of catalogSeq) if (key.startsWith(`${connId}/`)) catalogSeq.set(key, n + 1);
};
const uid = () => `${Date.now().toString(36)}-${(tabSeq++).toString(36)}`;

const DEFAULT_SETTINGS: Settings = { providers: [], row_limit: 1000, agent_allow_writes: false, theme: "system" };

export const useStore = create<State>((set, get) => ({
  connections: [],
  live: {},
  tabs: [{ id: "welcome", kind: "welcome", connectionId: null, title: "Welcome" }],
  activeTab: "welcome",
  settings: DEFAULT_SETTINGS,
  toasts: [],
  dashboards: [],
  savedQueries: [],
  history: [],
  sidebarFilter: "",
  chatOpen: false,
  chatSessionId: null,
  chatPrefill: null,
  secretStorage: null,

  init: async () => {
    const [connections, settings, dashboards, savedQueries, history, secretStorage] = await Promise.all([
      api.listConnections(),
      api.getSettings().catch(() => DEFAULT_SETTINGS),
      api.kvGet<Dashboard[]>("dashboards"),
      api.kvGet<SavedQuery[]>("saved_queries"),
      api.kvGet<HistoryEntry[]>("history"),
      api.secretStorage().catch(() => null),
    ]);
    set({
      connections,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      dashboards: dashboards ?? [],
      savedQueries: savedQueries ?? [],
      history: history ?? [],
      secretStorage,
    });
    applyTheme(settings.theme ?? "system", settings.editor_font_size ?? null);
    // Statements the agent runs are appended by the backend; mirror them into the list.
    void listen<HistoryEntry>("history:added", ({ payload }) =>
      set((s) => ({ history: [payload, ...s.history].slice(0, 500) })),
    );
  },

  refreshConnections: async () => set({ connections: await api.listConnections() }),

  connect: async (id, database) => {
    const cfg = get().connections.find((c) => c.id === id);
    if (!cfg) return;
    set((s) => ({ live: { ...s.live, [id]: { ...(s.live[id] ?? emptyLive(id)), loading: true } } }));
    try {
      const r = await api.connect(id, database);
      const isSqlDriver = ["postgres", "mysql", "mariadb", "sqlite"].includes(cfg.driver);
      const [schemas, databases] = await Promise.all([
        isSqlDriver ? api.listSchemas(id) : Promise.resolve([]),
        api.listDatabases(id).catch(() => [] as string[]),
      ]);
      const first = schemas[0];
      set((s) => ({
        live: {
          ...s.live,
          [id]: {
            id,
            database: r.database,
            version: r.server_version,
            schemas,
            tables: {},
            catalog: {},
            databases,
            expanded: first ? { [first]: true } : {},
          },
        },
      }));
      if (first) await get().loadTables(id, first);
      get().toast(`Connected to ${cfg.name}${r.server_version ? ` · ${r.server_version}` : ""}`, "success");
    } catch (e) {
      set((s) => {
        const live = { ...s.live };
        delete live[id];
        return { live };
      });
      get().toast(errMsg(e), "error");
      throw e;
    }
  },

  disconnect: async (id) => {
    await api.disconnect(id).catch(() => {});
    invalidateCatalog(id);
    set((s) => {
      const live = { ...s.live };
      delete live[id];
      const tabs = s.tabs.filter((t) => t.connectionId !== id);
      const activeTab = tabs.some((t) => t.id === s.activeTab) ? s.activeTab : (tabs[tabs.length - 1]?.id ?? null);
      return { live, tabs, activeTab };
    });
  },

  loadTables: async (connId, schema) => {
    try {
      const tables = await api.listTables(connId, schema);
      set((s) => {
        const l = s.live[connId];
        if (!l) return {};
        return { live: { ...s.live, [connId]: { ...l, tables: { ...l.tables, [schema]: tables } } } };
      });
      // Completion catalog is best-effort and must neither delay nor break the sidebar.
      const key = `${connId}/${schema}`;
      const seq = (catalogSeq.get(key) ?? 0) + 1;
      catalogSeq.set(key, seq);
      void api
        .schemaCatalog(connId, schema)
        .then((catalog) =>
          set((s) => {
            const l = s.live[connId];
            if (!l || catalogSeq.get(key) !== seq) return {};
            return { live: { ...s.live, [connId]: { ...l, catalog: { ...l.catalog, [schema]: catalog } } } };
          }),
        )
        .catch((e) => console.warn("schema catalog", errMsg(e)));
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },

  refreshSchema: async (connId) => {
    const l = get().live[connId];
    if (!l) return;
    try {
      const schemas = await api.listSchemas(connId);
      invalidateCatalog(connId); // a slow pre-refresh catalog must not land on the cleared state
      set((s) => ({ live: { ...s.live, [connId]: { ...s.live[connId], schemas, tables: {}, catalog: {} } } }));
      await Promise.all(schemas.filter((sc) => l.expanded[sc]).map((sc) => get().loadTables(connId, sc)));
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },

  toggleSchema: (connId, schema) => {
    const l = get().live[connId];
    if (!l) return;
    const open = !l.expanded[schema];
    set((s) => ({ live: { ...s.live, [connId]: { ...l, expanded: { ...l.expanded, [schema]: open } } } }));
    if (open && !l.tables[schema]) void get().loadTables(connId, schema);
  },

  openTab: (tab) => {
    const existing = get().tabs.find((t) => {
      if (t.kind !== tab.kind || t.connectionId !== tab.connectionId) return false;
      switch (tab.kind) {
        case "table":
          return t.kind === "table" && t.schema === tab.schema && t.table === tab.table;
        case "mongo":
          return t.kind === "mongo" && t.db === tab.db && t.collection === tab.collection;
        case "dashboard":
          return t.kind === "dashboard" && t.dashboardId === tab.dashboardId;
        case "chat":
          return t.kind === "chat" && t.sessionId === tab.sessionId;
        case "erd":
          return t.kind === "erd" && t.schema === tab.schema;
        case "redis":
          return true;
        default:
          return false;
      }
    });
    if (existing) {
      // Re-opening a table with a filter (FK jump) re-targets the already open tab.
      if (tab.kind === "table" && tab.filter !== undefined) get().updateTab(existing.id, { filter: tab.filter });
      set({ activeTab: existing.id });
      return existing.id;
    }
    const id = tab.id ?? uid();
    const t = { ...tab, id } as Tab;
    set((s) => ({ tabs: [...s.tabs.filter((x) => x.kind !== "welcome"), t], activeTab: id }));
    return id;
  },

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      let tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) tabs = [{ id: "welcome", kind: "welcome", connectionId: null, title: "Welcome" }];
      const activeTab = s.activeTab === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTab;
      return { tabs, activeTab };
    }),

  setActiveTab: (id) => set({ activeTab: id }),
  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) })),

  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  saveSettings: async (settings) => {
    await api.saveSettings(settings);
    set({ settings });
    applyTheme(settings.theme ?? "system", settings.editor_font_size ?? null);
  },

  saveDashboard: async (d) => {
    const list = get()
      .dashboards.filter((x) => x.id !== d.id)
      .concat({ ...d, updated_at: new Date().toISOString() });
    await api.kvSet("dashboards", list);
    set({ dashboards: list });
  },
  deleteDashboard: async (id) => {
    const list = get().dashboards.filter((x) => x.id !== id);
    await api.kvSet("dashboards", list);
    set({ dashboards: list });
    for (const t of get().tabs) if (t.kind === "dashboard" && t.dashboardId === id) get().closeTab(t.id);
  },
  saveQuery: (q) =>
    writeSavedQueries((before) => {
      const next = withVersion(
        before.find((x) => x.id === q.id),
        q,
      );
      return before.filter((x) => x.id !== q.id).concat(next);
    }),
  deleteSavedQuery: (id) => writeSavedQueries((before) => before.filter((x) => x.id !== id)),
  addHistory: async (h) => {
    set((s) => ({ history: [h, ...s.history].slice(0, 500) }));
    await api.historyAdd(h).catch(() => {});
  },
  clearHistory: async () => {
    set({ history: [] });
    await api.kvSet("history", []);
  },
  setSidebarFilter: (sidebarFilter) => set({ sidebarFilter }),
  setChatOpen: (chatOpen, sessionId) =>
    set((s) => ({ chatOpen, chatSessionId: sessionId === undefined ? s.chatSessionId : sessionId })),
  askAssistant: (prefill) => set({ chatOpen: true, chatPrefill: prefill }),
  takeChatPrefill: () => {
    const p = get().chatPrefill;
    if (p !== null) set({ chatPrefill: null });
    return p;
  },
}));

// Every saved-query write rewrites the whole list, so they run one at a time: each mutation
// starts from the state the previous one left, is shown immediately, and rolls back to the last
// persisted list if its write fails.
let savedQueue: Promise<unknown> = Promise.resolve();
function writeSavedQueries(mutate: (before: SavedQuery[]) => SavedQuery[]): Promise<void> {
  const run = async () => {
    const before = useStore.getState().savedQueries;
    const list = mutate(before);
    useStore.setState({ savedQueries: list });
    try {
      await api.kvSet("saved_queries", list);
    } catch (e) {
      useStore.setState({ savedQueries: before });
      throw e;
    }
  };
  const p = savedQueue.then(run, run);
  savedQueue = p.catch(() => {});
  return p;
}

export function emptyLive(id: string): LiveConn {
  return { id, database: "", version: null, schemas: [], tables: {}, catalog: {}, databases: [], expanded: {} };
}

export function applyTheme(theme: string, fontSize: number | null) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  root.style.setProperty("--editor-font-size", `${fontSize ?? 13}px`);
}

export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeTab) ?? null);
export const useConnection = (id: string | null) =>
  useStore((s) => (id ? (s.connections.find((c) => c.id === id) ?? null) : null));
export { type ChatSession };
