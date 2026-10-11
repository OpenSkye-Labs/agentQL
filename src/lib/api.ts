import { invoke } from "@tauri-apps/api/core";
import type {
  Cell,
  ChatSession,
  ConnectionConfig,
  ConnectionSecrets,
  Driver,
  HistoryEntry,
  MongoFind,
  MongoPage,
  QueryResult,
  RowChange,
  ScanResult,
  SchemaCatalog,
  ScopeEntry,
  SchemaObject,
  Settings,
  TableDetails,
  TableInfo,
  TablePage,
  TableQuery,
  WriteInfo,
} from "./types";

export interface ConnectResult {
  id: string;
  driver: string;
  database: string;
  server_version: string | null;
}

export const api = {
  // connections
  listConnections: () => invoke<ConnectionConfig[]>("list_connections"),
  saveConnection: (config: ConnectionConfig, secrets?: ConnectionSecrets) =>
    invoke<ConnectionConfig>("save_connection", { config, secrets }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),
  getConnectionSecrets: (id: string) => invoke<ConnectionSecrets>("get_connection_secrets", { id }),
  secretStorage: () => invoke<"keychain" | "file">("secret_storage"),
  testConnection: (config: ConnectionConfig, secrets?: ConnectionSecrets) =>
    invoke<string>("test_connection", { config, secrets }),
  connect: (id: string, database?: string) => invoke<ConnectResult>("connect", { id, database }),
  disconnect: (id: string) => invoke<void>("disconnect", { id }),
  connectedConnections: () => invoke<string[]>("connected_connections"),

  // sql
  runQuery: (id: string, sqlText: string, limit?: number) => invoke<QueryResult[]>("run_query", { id, sqlText, limit }),
  classifySql: (driver: Driver, sqlText: string) => invoke<WriteInfo[]>("classify_sql", { driver, sqlText }),
  explainQuery: (id: string, sqlText: string, analyze: boolean) =>
    invoke<QueryResult>("explain_query", { id, sqlText, analyze }),
  listDatabases: (id: string) => invoke<string[]>("list_databases", { id }),
  listSchemas: (id: string) => invoke<string[]>("list_schemas", { id }),
  listTables: (id: string, schema: string) => invoke<TableInfo[]>("list_tables", { id, schema }),
  tableDetails: (id: string, schema: string, table: string) =>
    invoke<TableDetails>("table_details", { id, schema, table }),
  schemaCatalog: (id: string, schema: string) => invoke<SchemaCatalog>("schema_catalog", { id, schema }),
  fetchTable: (id: string, query: TableQuery) => invoke<TablePage>("fetch_table", { id, query }),
  countTable: (id: string, query: TableQuery) => invoke<number>("count_table", { id, query }),
  previewChanges: (
    id: string,
    schema: string | null,
    table: string,
    changes: RowChange[],
    types?: Record<string, string>,
  ) => invoke<string[]>("preview_changes", { id, schema, table, changes, types }),
  applyChanges: (
    id: string,
    schema: string | null,
    table: string,
    changes: RowChange[],
    types?: Record<string, string>,
  ) => invoke<number>("apply_changes", { id, schema, table, changes, types }),
  sshForgetHost: (host: string, port: number) => invoke<void>("ssh_forget_host", { host, port }),
  exportRows: (path: string, format: "csv" | "json" | "sql", columns: string[], rows: Cell[][]) =>
    invoke<number>("export_rows", { path, format, columns, rows }),
  schemaObjects: (id: string, schema: string) => invoke<SchemaObject[]>("schema_objects", { id, schema }),
  /** `data` is base64. */
  saveFile: (path: string, data: string) => invoke<void>("save_file", { path, data }),

  // redis
  redisScan: (id: string, cursor: string, pattern: string, count = 200) =>
    invoke<ScanResult>("redis_scan", { id, cursor, pattern, count }),
  redisGet: (id: string, key: string) => invoke<RedisValue>("redis_get", { id, key }),
  redisCommand: (id: string, command: string) => invoke<unknown>("redis_command", { id, command }),
  redisExec: (id: string, args: string[]) => invoke<unknown>("redis_exec", { id, args }),
  redisInfo: (id: string) => invoke<Record<string, string>>("redis_info", { id }),

  // mongo
  mongoCollections: (id: string, db: string) =>
    invoke<{ name: string; count: number | null }[]>("mongo_collections", { id, db }),
  mongoFind: (id: string, query: MongoFind) => invoke<MongoPage>("mongo_find", { id, query }),
  mongoAggregate: (id: string, db: string, collection: string, pipeline: unknown, limit?: number) =>
    invoke<Record<string, unknown>[]>("mongo_aggregate", { id, db, collection, pipeline, limit }),
  mongoInsert: (id: string, db: string, collection: string, document: unknown) =>
    invoke<unknown>("mongo_insert", { id, db, collection, document }),
  mongoReplace: (id: string, db: string, collection: string, docId: unknown, document: unknown) =>
    invoke<number>("mongo_replace", { id, db, collection, docId, document }),
  mongoDelete: (id: string, db: string, collection: string, docId: unknown) =>
    invoke<number>("mongo_delete", { id, db, collection, docId }),
  mongoCollectionInfo: (id: string, db: string, collection: string) =>
    invoke<{ stats: unknown; indexes: unknown[]; fields: Record<string, string> }>("mongo_collection_info", {
      id,
      db,
      collection,
    }),

  // settings / kv
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  checkUpdate: () => invoke<{ version: string; notes: string | null } | null>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
  setProviderKey: (providerId: string, key: string | null) => invoke<void>("set_provider_key", { providerId, key }),
  hasProviderKey: (providerId: string) => invoke<boolean>("has_provider_key", { providerId }),
  systemTheme: () => invoke<"dark" | "light" | null>("system_theme"),
  detectClis: () => invoke<{ claude: string | null; codex: string | null }>("detect_clis"),
  kvGet: <T>(name: string) => invoke<T | null>("kv_get", { name }),
  kvSet: (name: string, value: unknown) => invoke<void>("kv_set", { name, value }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, contents: string) => invoke<void>("write_text_file", { path, contents }),
  historyAdd: (entry: HistoryEntry) => invoke<void>("history_add", { entry }),
  setAgentScope: (id: string, scope: ScopeEntry[] | null) => invoke<void>("set_agent_scope", { id, scope }),

  // ai
  aiListSessions: (connectionId?: string) => invoke<ChatSession[]>("ai_list_sessions", { connectionId }),
  aiGetSession: (id: string) => invoke<ChatSession>("ai_get_session", { id }),
  aiCreateSession: (connectionId: string, providerId: string) =>
    invoke<ChatSession>("ai_create_session", { connectionId, providerId }),
  aiDeleteSession: (id: string) => invoke<void>("ai_delete_session", { id }),
  aiSetSessionProvider: (id: string, providerId: string) => invoke<void>("ai_set_session_provider", { id, providerId }),
  aiSend: (sessionId: string, text: string) => invoke<void>("ai_send", { sessionId, text }),
  aiCancel: (sessionId: string) => invoke<void>("ai_cancel", { sessionId }),
  aiResolveApproval: (id: string, approved: boolean) => invoke<void>("ai_resolve_approval", { id, approved }),
  runChart: (connectionId: string, source: unknown) =>
    invoke<QueryResult>("run_chart", { req: { connection_id: connectionId, source } }),
  appInfo: () =>
    invoke<{ version: string; data_dir: string; mcp_port: number | null; secret_storage: string }>("app_info"),
};

export interface RedisValue {
  key: string;
  type: string;
  ttl: number;
  size: number;
  value: unknown;
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
