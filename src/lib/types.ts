export type Driver = "postgres" | "mysql" | "mariadb" | "sqlite" | "redis" | "mongodb";

export const DRIVERS: { id: Driver; label: string; port: number; sql: boolean }[] = [
  { id: "postgres", label: "PostgreSQL", port: 5432, sql: true },
  { id: "mysql", label: "MySQL", port: 3306, sql: true },
  { id: "mariadb", label: "MariaDB", port: 3306, sql: true },
  { id: "sqlite", label: "SQLite", port: 0, sql: true },
  { id: "redis", label: "Redis", port: 6379, sql: false },
  { id: "mongodb", label: "MongoDB", port: 27017, sql: false },
];

export const isSql = (d: Driver) => DRIVERS.find((x) => x.id === d)?.sql ?? false;
export const driverLabel = (d: Driver) => DRIVERS.find((x) => x.id === d)?.label ?? d;

export type SshAuth = "agent" | { key_file: { path: string } } | "password";

export interface SshConfig {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
}

/** One allowed item of the agent scope: a whole schema (no table) or a single table. */
export interface ScopeEntry {
  schema: string;
  table?: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: Driver;
  color?: string | null;
  group?: string | null;
  url?: string | null;
  host: string;
  port: number;
  user: string;
  database: string;
  file_path?: string | null;
  ssl_mode?: string | null;
  ssl_ca_path?: string | null;
  ssl_cert_path?: string | null;
  ssl_key_path?: string | null;
  ssh?: SshConfig | null;
  read_only: boolean;
  options: Record<string, string>;
  /** Schemas/tables the AI agent may see; absent = everything. */
  agent_scope?: ScopeEntry[] | null;
  /** When the user allowed sending this connection's schema and data to a remote LLM provider. */
  agent_remote_consent_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ConnectionSecrets {
  password?: string | null;
  ssh_password?: string | null;
  ssh_key_passphrase?: string | null;
}

export interface Column {
  name: string;
  type_name: string;
}

export type Cell = null | boolean | number | string | Cell[] | { [k: string]: Cell } | { $bytes: string; len: number };

export interface QueryResult {
  columns: Column[];
  rows: Cell[][];
  affected: number | null;
  duration_ms: number;
  truncated: boolean;
  statement: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: "table" | "view" | "matview" | "foreign" | string;
  row_estimate: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default: string | null;
  is_primary: boolean;
  position: number;
  comment: string | null;
  extra: string | null;
}
export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string | null;
}
export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  ref_schema: string | null;
  ref_table: string;
  ref_columns: string[];
}
export interface TableDetails {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  ddl: string | null;
}

export interface TableQuery {
  schema?: string | null;
  table: string;
  filter?: string | null;
  order_by?: string | null;
  order_desc: boolean;
  limit: number;
  offset: number;
}

export interface TablePage {
  result: QueryResult;
  total: number | null;
  sql_text: string;
}

export type RowChange =
  | { op: "update"; key: Record<string, Cell>; values: Record<string, Cell> }
  | { op: "insert"; values: Record<string, Cell> }
  | { op: "delete"; key: Record<string, Cell> };

export interface RedisKey {
  key: string;
  kind: string;
  ttl: number;
}
export interface ScanResult {
  cursor: string;
  keys: RedisKey[];
}

export interface MongoFind {
  db: string;
  collection: string;
  filter?: unknown;
  sort?: unknown;
  projection?: unknown;
  limit: number;
  skip: number;
}
export interface MongoPage {
  docs: Record<string, unknown>[];
  total: number | null;
}

export type ProviderKind = "anthropic" | "openai" | "openai_compatible" | "claude_cli" | "codex_cli";

export interface LlmProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url?: string | null;
  model: string;
  command?: string | null;
  extra_headers: Record<string, string>;
}

export interface Settings {
  providers: LlmProvider[];
  default_provider?: string | null;
  row_limit: number;
  agent_allow_writes: boolean;
  theme?: "light" | "dark" | "system" | null;
  editor_font_size?: number | null;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean; display?: unknown };

export interface Message {
  role: "user" | "assistant";
  blocks: Block[];
  ts: string;
}

export interface ChatSession {
  id: string;
  connection_id: string;
  provider_id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
  cli_session_id?: string | null;
}

export type AgentEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; content: string; is_error: boolean; display: unknown }
  | { kind: "approval_request"; id: string; approval_kind: "write" | "consent"; description: string; statement: string }
  | { kind: "status"; text: string }
  | { kind: "done"; session: ChatSession }
  | { kind: "error"; message: string };

export type ChartType = "bar" | "line" | "area" | "pie" | "number" | "table";

export interface ChartSpec {
  id: string;
  title: string;
  description?: string | null;
  chart_type: ChartType;
  x?: string | null;
  y: string[];
  source: { kind: "sql"; sql: string } | { kind: "mongo"; db: string; collection: string; pipeline: unknown[] };
}

export interface Dashboard {
  id: string;
  connection_id: string;
  title: string;
  description?: string | null;
  charts: ChartSpec[];
  created_at: string;
  updated_at: string;
}

export interface QueryVersion {
  sql: string;
  ts: string;
}

export interface SavedQuery {
  id: string;
  connection_id: string | null;
  name: string;
  sql: string;
  created_at: string;
  updated_at?: string;
  /** Previous edits, newest first, capped at MAX_QUERY_VERSIONS. */
  versions?: QueryVersion[];
}

export const MAX_QUERY_VERSIONS = 20;

export interface HistoryEntry {
  id: string;
  connection_id: string;
  sql: string;
  ts: string;
  duration_ms: number;
  ok: boolean;
  rows?: number;
  /** Set when the AI agent ran the statement. */
  source?: "agent";
  session_id?: string;
}
