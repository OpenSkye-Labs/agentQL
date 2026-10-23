/**
 * In-page fake of the Tauri IPC surface for visual QA and demo recordings in a plain browser (`?mock=1`, dev
 * only). No network, no backend: every command answers from the demo dataset in `mockData.ts`, and chat prompts
 * play scripted agent runs (`mockAgent.ts`) through real `ai:event`s.
 */
import { createAgent } from "./mockAgent";
import {
  SPECS,
  catalog,
  chartDataFor,
  connections,
  dashboards,
  history,
  mongoCollections,
  mongoDocs,
  mongoFields,
  qr,
  redisKeys,
  redisValue,
  savedQueries,
  schemaObjects,
  tableDetails,
  tablePage,
  tables,
} from "./mockData";
import { statementBounds } from "./sql";
import type { ConnectionConfig, Note, ScopeEntry, Settings, TableQuery } from "./types";

type Handler = (args: Record<string, unknown>) => unknown;

const settings: Settings = {
  providers: [
    { id: "claude-cli", name: "Claude Code (subscription)", kind: "claude_cli", model: "", extra_headers: {} },
    { id: "codex-cli", name: "Codex CLI (ChatGPT)", kind: "codex_cli", model: "", extra_headers: {} },
  ],
  default_provider: "claude-cli",
  row_limit: 1000,
  // On, so the scripted write run shows the approval card; turning it off in the UI is honoured.
  agent_allow_writes: true,
  theme: "system",
};

// Tauri event plumbing: `listen()` registers a callback via transformCallback, then `plugin:event|listen` binds
// it to an event name. `emit` calls every callback bound to that event, like the backend's `app.emit`.
const callbacks = new Map<number, (e: unknown) => void>();
const listeners = new Map<number, { event: string; handler: number }>();
let seq = 1;
function emit(event: string, payload: unknown) {
  for (const [id, l] of listeners) if (l.event === event) callbacks.get(l.handler)?.({ event, id, payload });
}

const agent = createAgent(emit, () => settings.agent_allow_writes);

/** Data-dictionary notes per connection, in memory, seeded so the structure and notes tabs have content. */
const notes: Record<string, Note[]> = {
  pg: [
    { schema: "public", table: "orders", text: "One row per checkout; refunds are new rows with a negative total." },
    {
      schema: "public",
      table: "orders",
      column: "status",
      text: "processing → shipped → delivered; cancelled orders never ship.",
    },
    { schema: "public", table: "orders", metric: "revenue", text: "SUM(total) WHERE status <> 'cancelled'" },
  ],
};
const sameTarget = (a: Note, b: Note) =>
  a.schema === b.schema &&
  a.table === b.table &&
  (a.column ?? null) === (b.column ?? null) &&
  (a.metric ?? null) === (b.metric ?? null);

/** Persisted KV, in memory: what the app saves (a chart added to a dashboard) reads back until reload. */
const kv: Record<string, unknown> = { dashboards, history, saved_queries: savedQueries };

/** The table a statement reads, if it names one we know. ponytail: regex, not a parser; mock routing only. */
const tableIn = (sql: string) => {
  const m = /\bfrom\s+(?:"?\w+"?\.)?"?(\w+)"?/i.exec(sql);
  return m && SPECS[m[1]] ? m[1] : null;
};
const isRead = (sql: string) =>
  /^\s*(select|with|show|explain|values|table)\b/i.test(sql.replace(/^(\s*(--[^\n]*|\/\*[\s\S]*?\*\/))*/, ""));

/** Statements in an editor buffer, split by the same tokenizer the editor uses. */
function statements(text: string) {
  const b = statementBounds(text);
  return b
    .slice(0, -1)
    .map((start, i) =>
      text
        .slice(start, b[i + 1])
        .trim()
        .replace(/;$/, "")
        .trim(),
    )
    .filter(Boolean);
}

function runStatement(sql: string, limit: number) {
  if (!isRead(sql)) return qr([], [], sql, { affected: 1, duration_ms: 7 });
  if (/\b(sum|count|avg)\s*\(/i.test(sql) && /group\s+by/i.test(sql)) return { ...chartDataFor(sql), statement: sql };
  // ponytail: rows are capped at 200 so the mock stays fast; an explicit trailing LIMIT is honoured.
  const own = Number(/\blimit\s+(\d+)\s*$/i.exec(sql)?.[1] ?? Infinity);
  const page = tablePage(tableIn(sql) ?? "orders", 0, Math.min(limit, own, 200), sql);
  return own <= Math.min(limit, 200) ? { ...page, truncated: false } : page;
}

const handlers: Record<string, Handler> = {
  list_connections: () => connections,
  save_connection: (a) => ({ ...(a.config as ConnectionConfig), id: (a.config as ConnectionConfig).id || "new" }),
  get_connection_secrets: () => ({ password: "secret" }),
  secret_storage: () => "file",
  test_connection: () => "PostgreSQL 16.4",
  connect: (a) => ({
    id: a.id,
    driver: connections.find((c) => c.id === a.id)?.driver,
    database: connections.find((c) => c.id === a.id)?.database,
    server_version: a.id === "pg" ? "16.4" : a.id === "redis" ? "Redis 7.4.1" : "MongoDB 7.0.14",
  }),
  disconnect: () => null,
  connected_connections: () => [],
  list_databases: (a) =>
    a.id === "pg"
      ? ["postgres", "shop", "shop_staging"]
      : a.id === "mongo"
        ? ["analytics", "admin", "local"]
        : ["0", "1", "2"],
  list_schemas: () => ["public", "audit"],
  list_tables: (a) => tables(String(a.schema)),
  schema_catalog: (a) => catalog(String(a.schema)),
  table_details: (a) => tableDetails(String(a.table)),
  schema_objects: (a) => schemaObjects(String(a.schema)),
  save_file: () => null,
  fetch_table: (a) => {
    // ponytail: filter and sort are ignored; the page is the table in id order.
    const q = a.query as TableQuery;
    const sql = `SELECT * FROM "${q.schema ?? "public"}"."${q.table}" LIMIT ${q.limit} OFFSET ${q.offset}`;
    return { result: tablePage(q.table, q.offset, q.limit, sql), total: null, sql_text: sql };
  },
  count_table: (a) => SPECS[(a.query as TableQuery).table]?.rows ?? 0,
  run_query: (a) => {
    const stmts = statements(String(a.sqlText));
    return (stmts.length ? stmts : [String(a.sqlText)]).map((s) => runStatement(s, Number(a.limit ?? 1000)));
  },
  classify_sql: (a) =>
    statements(String(a.sqlText))
      .filter((s) => !isRead(s))
      .map((s) => ({
        kind: s.split(/\s+/)[0].toUpperCase(),
        table: tableIn(s) ?? /\b(?:update|into)\s+"?(\w+)/i.exec(s)?.[1] ?? null,
      })),
  explain_query: (a) =>
    qr(
      [["QUERY PLAN", "text"]],
      [
        ["Limit  (cost=0.42..8.44 rows=100 width=72)"],
        [
          `  ->  Index Scan Backward using ${tableIn(String(a.sqlText)) ?? "orders"}_pkey on ${tableIn(String(a.sqlText)) ?? "orders"}  (cost=0.42..14630.42 rows=182400 width=72)`,
        ],
      ],
    ),
  preview_changes: (a) => [`UPDATE "public"."${String(a.table)}" SET "status" = 'shipped' WHERE "id" = 1042`],
  apply_changes: () => 1,
  export_rows: () => 120,
  redis_scan: () => ({ cursor: "0", keys: redisKeys }),
  redis_get: (a) => redisValue(String(a.key)),
  redis_command: () => ({ redis_version: "7.4.1", used_memory_human: "38.20M" }),
  redis_exec: () => "OK",
  redis_info: () => ({ redis_version: "7.4.1", dbsize: "21482", used_memory_human: "38.20M" }),
  mongo_collections: () => mongoCollections,
  mongo_find: (a) => {
    const q = a.query as { collection: string; skip?: number; limit?: number };
    const total = mongoCollections.find((c) => c.name === q.collection)?.count ?? 0;
    return { docs: mongoDocs(q.collection, q.skip ?? 0, Math.min(q.limit ?? 50, 100)), total };
  },
  mongo_aggregate: () => [
    { _id: "page_view", n: 812_204 },
    { _id: "product_view", n: 241_660 },
    { _id: "add_to_cart", n: 88_412 },
    { _id: "checkout_started", n: 31_870 },
    { _id: "order_placed", n: 21_442 },
  ],
  mongo_collection_info: (a) => ({
    stats: {},
    indexes: [
      { name: "_id_", keys: { _id: 1 }, unique: true },
      { name: "user_1_ts_-1", keys: { user: 1, ts: -1 }, unique: false },
    ],
    fields: mongoFields[String(a.collection)] ?? mongoFields.events,
  }),
  get_settings: () => settings,
  save_settings: (a) => void Object.assign(settings, a.settings as Settings),
  system_theme: () => null,
  set_provider_key: () => null,
  has_provider_key: () => false,
  detect_clis: () => ({ claude: "/home/you/.local/bin/claude", codex: "/home/you/.local/bin/codex" }),
  kv_get: (a) => kv[String(a.name)] ?? null,
  kv_set: (a) => void (kv[String(a.name)] = a.value),
  read_text_file: () => "SELECT 1;\n",
  write_text_file: () => null,
  history_add: () => null,
  set_agent_scope: (a) => {
    const c = connections.find((x) => x.id === a.id);
    if (c) c.agent_scope = (a.scope as ScopeEntry[] | null) ?? null;
    return null;
  },
  notes_list: (a) => notes[String(a.connectionId)] ?? [],
  note_save: (a) => {
    const id = String(a.connectionId);
    const note = { ...(a.note as Note), text: (a.note as Note).text.trim() };
    notes[id] = [...(notes[id] ?? []).filter((n) => !sameTarget(n, note)), ...(note.text ? [note] : [])];
    emit("notes:changed", id);
    return null;
  },
  ai_list_sessions: (a) => agent.list(a.connectionId as string | undefined),
  ai_get_session: (a) => agent.get(String(a.id)),
  ai_create_session: (a) => agent.create(String(a.connectionId), String(a.providerId)),
  ai_delete_session: (a) => agent.remove(String(a.id)),
  ai_set_session_provider: (a) => agent.setProvider(String(a.id), String(a.providerId)),
  ai_send: (a) => agent.send(String(a.sessionId), String(a.text)),
  ai_cancel: (a) => agent.cancel(String(a.sessionId)),
  ai_resolve_approval: (a) => agent.resolveApproval(String(a.id), Boolean(a.approved)),
  run_chart: (a) => {
    const src = (a.req as { source: { kind: string; sql?: string } }).source;
    return chartDataFor(src.sql ?? "");
  },
  app_info: () => ({
    version: "0.2.0",
    data_dir: "/home/you/.local/share/com.aindong.agentql",
    mcp_port: 41231,
    secret_storage: "file",
  }),
};

if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  !("__TAURI_INTERNALS__" in window) &&
  new URLSearchParams(location.search).has("mock")
) {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (cb: (e: unknown) => void) => {
      const id = seq++;
      callbacks.set(id, cb);
      return id;
    },
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "plugin:event|listen") {
        const id = seq++;
        listeners.set(id, { event: String(args.event), handler: Number(args.handler) });
        return id;
      }
      if (cmd === "plugin:event|unlisten") {
        const l = listeners.get(Number(args.eventId));
        if (l) callbacks.delete(l.handler);
        listeners.delete(Number(args.eventId));
        return null;
      }
      if (cmd.startsWith("plugin:event|")) return null;
      if (cmd.startsWith("plugin:dialog|")) return null;
      if (cmd.startsWith("plugin:opener|")) return null;
      const h = handlers[cmd];
      if (!h) throw `mock: unknown command ${cmd}`;
      await new Promise((r) => setTimeout(r, 30));
      return h(args);
    },
  };
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
}
