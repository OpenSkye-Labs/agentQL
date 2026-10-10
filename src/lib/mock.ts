/**
 * In-page fake of the Tauri IPC surface for visual QA in a plain browser (`?mock=1`, dev only).
 * No network, no backend: every command answers from the sample data below.
 */
import type { ChatSession, ConnectionConfig, QueryResult, Settings, TableInfo } from "./types";

type Handler = (args: Record<string, unknown>) => unknown;

const connections: ConnectionConfig[] = [
  {
    id: "pg",
    name: "facefound (local Postgres)",
    driver: "postgres",
    color: "#3b6cf6",
    group: "Local",
    host: "127.0.0.1",
    port: 5433,
    user: "gotfound",
    database: "facefound",
    ssl_mode: "disable",
    read_only: false,
    options: {},
  },
  {
    id: "redis",
    name: "yowork (local Redis)",
    driver: "redis",
    color: "#d23f3f",
    group: "Local",
    host: "127.0.0.1",
    port: 6379,
    user: "",
    database: "0",
    read_only: true,
    options: {},
  },
  {
    id: "mongo",
    name: "analytics (Mongo)",
    driver: "mongodb",
    color: "#1f8f5a",
    group: "Staging",
    host: "10.0.0.4",
    port: 27017,
    user: "app",
    database: "analytics",
    read_only: false,
    options: {},
  },
];

const tables: TableInfo[] = [
  ["ApiClient", 12],
  ["Candidate", 300],
  ["ChatMessage", 52],
  ["Claim", 1251],
  ["EngineCache", 5],
  ["EngineHit", 1062],
  ["FaceBlocklist", 0],
  ["FaceCompareCache", 62],
  ["FaceObservation", 1787],
  ["Mention", 472],
  ["NameCandidate", 338],
  ["Person", 14022],
  ["Search", 9130],
  ["Tenant", 3],
].map(([name, n]) => ({ schema: "public", name: String(name), kind: "table", row_estimate: Number(n) }));
tables.push({ schema: "public", name: "v_recent_claims", kind: "view", row_estimate: null });

const columns = ["id", "name", "email", "status", "score", "tags", "createdAt", "meta"];
const types = ["uuid", "text", "text", "text", "numeric", "text[]", "timestamptz", "jsonb"];
const names = [
  "Ada Lovelace",
  "Grace Hopper",
  "Linus Torvalds",
  "Margaret Hamilton",
  "Ken Thompson",
  "Barbara Liskov",
  "Dennis Ritchie",
  "Radia Perlman",
];
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => [
    `6f1c${(1000 + i).toString(16)}-8a1d-4f2e-9b3c-${(100000000000 + i * 7919).toString().slice(0, 12)}`,
    names[i % names.length],
    i % 5 === 0 ? null : `${names[i % names.length].split(" ")[0].toLowerCase()}${i}@example.com`,
    ["active", "pending", "blocked"][i % 3],
    Math.round((Math.sin(i) + 1.2) * 4321) / 100,
    i % 4 === 0 ? ["vip", "beta"] : ["standard"],
    new Date(Date.UTC(2026, 8, 1 + (i % 28), (i * 7) % 24, (i * 13) % 60))
      .toISOString()
      .replace("T", " ")
      .replace("Z", "+00"),
    { source: ["import", "api", "manual"][i % 3], attempts: i % 7 },
  ]);
}
const result = (n: number, stmt = 'SELECT * FROM "Candidate"'): QueryResult => ({
  columns: columns.map((c, i) => ({ name: c, type_name: types[i] })),
  rows: rows(n),
  affected: null,
  duration_ms: 12,
  truncated: false,
  statement: stmt,
});

const settings: Settings = {
  providers: [
    { id: "claude-cli", name: "Claude Code (subscription)", kind: "claude_cli", model: "", extra_headers: {} },
    { id: "codex-cli", name: "Codex CLI (ChatGPT)", kind: "codex_cli", model: "", extra_headers: {} },
  ],
  default_provider: "claude-cli",
  row_limit: 1000,
  agent_allow_writes: false,
  theme: "system",
};

const chart = {
  id: "c1",
  title: "Observations per day",
  description: "Face observations over the last 14 days",
  chart_type: "bar",
  x: "day",
  y: ["observations"],
  source: {
    kind: "sql",
    sql: 'SELECT date_trunc(\'day\', "createdAt") AS day, count(*) AS observations FROM "FaceObservation" GROUP BY 1 ORDER BY 1',
  },
};
const chartData: QueryResult = {
  columns: [
    { name: "day", type_name: "date" },
    { name: "observations", type_name: "int8" },
  ],
  rows: Array.from({ length: 14 }, (_, i) => [`Sep ${i + 10}`, 40 + Math.round(Math.abs(Math.sin(i / 2)) * 120)]),
  affected: null,
  duration_ms: 8,
  truncated: false,
  statement: "",
};

const session: ChatSession = {
  id: "s1",
  connection_id: "pg",
  provider_id: "claude-cli",
  title: "What tables are here?",
  created_at: "2026-10-10T05:00:00Z",
  updated_at: "2026-10-10T05:02:00Z",
  messages: [
    {
      role: "user",
      ts: "",
      blocks: [{ type: "text", text: "What tables are here and how do they relate? Then chart observations per day." }],
    },
    {
      role: "assistant",
      ts: "",
      blocks: [{ type: "tool_use", id: "t1", name: "list_tables", input: { schema: "public" } }],
    },
    {
      role: "user",
      ts: "",
      blocks: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: tables.map((t) => `${t.name} (${t.kind}, ~${t.row_estimate} rows)`).join("\n"),
          is_error: false,
        },
      ],
    },
    {
      role: "assistant",
      ts: "",
      blocks: [
        {
          type: "tool_use",
          id: "t2",
          name: "run_sql",
          input: { sql: 'SELECT status, count(*) FROM "Candidate" GROUP BY 1 ORDER BY 2 DESC' },
        },
      ],
    },
    {
      role: "user",
      ts: "",
      blocks: [
        {
          type: "tool_result",
          tool_use_id: "t2",
          content: "| status | count |\n|---|---|\n| active | 180 |\n| pending | 90 |\n| blocked | 30 |",
          is_error: false,
          display: {
            type: "query_results",
            results: [
              {
                ...result(3),
                columns: [
                  { name: "status", type_name: "text" },
                  { name: "count", type_name: "int8" },
                ],
                rows: [
                  ["active", 180],
                  ["pending", 90],
                  ["blocked", 30],
                ],
              },
            ],
          },
        },
      ],
    },
    {
      role: "assistant",
      ts: "",
      blocks: [
        {
          type: "tool_use",
          id: "t3",
          name: "create_chart",
          input: { title: chart.title, chart_type: "bar", x: "day", y: ["observations"], sql: chart.source.sql },
        },
      ],
    },
    {
      role: "user",
      ts: "",
      blocks: [
        {
          type: "tool_result",
          tool_use_id: "t3",
          content: "Chart ready",
          is_error: false,
          display: { type: "chart", spec: chart, data: chartData },
        },
      ],
    },
    {
      role: "assistant",
      ts: "",
      blocks: [
        {
          type: "text",
          text: 'The database has **15 objects** in `public`. The core entities are `Person` → `Candidate` → `Claim`, with `FaceObservation` and `EngineHit` hanging off candidates.\n\nCandidate status split:\n\n| status | count |\n|---|---|\n| active | 180 |\n| pending | 90 |\n| blocked | 30 |\n\nHere is the query I used for the chart:\n\n```sql\nSELECT date_trunc(\'day\', "createdAt") AS day, count(*) AS observations\nFROM "FaceObservation"\nGROUP BY 1 ORDER BY 1;\n```',
        },
      ],
    },
  ],
};

const handlers: Record<string, Handler> = {
  list_connections: () => connections,
  save_connection: (a) => ({ ...(a.config as ConnectionConfig), id: (a.config as ConnectionConfig).id || "new" }),
  get_connection_secrets: () => ({ password: "secret" }),
  secret_storage: () => "file",
  test_connection: () => "PostgreSQL 16.13",
  connect: (a) => ({
    id: a.id,
    driver: connections.find((c) => c.id === a.id)?.driver,
    database: a.id === "pg" ? "facefound" : a.id === "redis" ? "0" : "analytics",
    server_version: a.id === "pg" ? "16.13" : a.id === "redis" ? "Redis 7.4.8" : "MongoDB 7.0.14",
  }),
  disconnect: () => null,
  connected_connections: () => [],
  list_databases: (a) =>
    a.id === "pg"
      ? ["blog", "census", "facefound", "gotfound", "rooc"]
      : a.id === "mongo"
        ? ["analytics", "admin", "local"]
        : ["0", "1", "2"],
  list_schemas: () => ["public", "audit"],
  list_tables: (a) =>
    a.schema === "public" ? tables : [{ schema: "audit", name: "events", kind: "table", row_estimate: 99120 }],
  table_details: () => ({
    columns: columns.map((c, i) => ({
      name: c,
      data_type: types[i],
      nullable: i !== 0 && i !== 1,
      default: i === 0 ? "gen_random_uuid()" : i === 6 ? "now()" : null,
      is_primary: i === 0,
      position: i + 1,
      comment: i === 4 ? "0–100 confidence" : null,
      extra: null,
    })),
    indexes: [
      {
        name: "Candidate_pkey",
        columns: ["id"],
        unique: true,
        primary: true,
        definition: 'CREATE UNIQUE INDEX "Candidate_pkey" ON public."Candidate" USING btree (id)',
      },
      { name: "Candidate_email_idx", columns: ["email"], unique: false, primary: false, definition: null },
    ],
    foreign_keys: [
      {
        name: "Candidate_personId_fkey",
        columns: ["personId"],
        ref_schema: "public",
        ref_table: "Person",
        ref_columns: ["id"],
      },
    ],
    ddl: 'CREATE TABLE "public"."Candidate" (\n  "id" uuid NOT NULL DEFAULT gen_random_uuid(),\n  "name" text NOT NULL,\n  "email" text,\n  "status" text,\n  "score" numeric,\n  "tags" text[],\n  "createdAt" timestamptz DEFAULT now(),\n  "meta" jsonb,\n  PRIMARY KEY ("id")\n);',
  }),
  fetch_table: (a) => ({
    result: result((a.query as { limit: number }).limit),
    total: null,
    sql_text: 'SELECT * FROM "public"."Candidate" LIMIT 250 OFFSET 0',
  }),
  count_table: () => 300,
  run_query: (a) => [result(120, String(a.sqlText))],
  explain_query: () => ({
    columns: [{ name: "QUERY PLAN", type_name: "text" }],
    rows: [
      ["Limit  (cost=0.00..0.07 rows=3 width=80)"],
      ['  ->  Seq Scan on "Candidate"  (cost=0.00..17.50 rows=750 width=80)'],
    ],
    affected: null,
    duration_ms: 2,
    truncated: false,
    statement: "",
  }),
  preview_changes: () => ['UPDATE "public"."Candidate" SET "status" = \'active\' WHERE "id" = \'…\''],
  apply_changes: () => 1,
  export_rows: () => 120,
  redis_scan: () => ({
    cursor: "1536",
    keys: [
      { key: "bull:audit-log:36702", kind: "hash", ttl: -1 },
      { key: "bull:audit-log:36593", kind: "hash", ttl: -1 },
      { key: "galaxy:tenant-person-search:f088d7dee0a48697", kind: "string", ttl: 324414 },
      { key: "bull:posthog-events-{analytics}:events", kind: "stream", ttl: -1 },
      { key: "session:9f1c2", kind: "string", ttl: 1800 },
      { key: "leaderboard:weekly", kind: "zset", ttl: -1 },
      { key: "queue:emails", kind: "list", ttl: -1 },
      { key: "online:users", kind: "set", ttl: 60 },
    ],
  }),
  redis_get: (a) => ({
    key: a.key,
    type: "hash",
    ttl: -1,
    size: 6,
    value: {
      ats: "1",
      returnvalue: "null",
      data: '{"userId":"bcd6ade6","action":"GET","resource":"/api/notifications/unread-count"}',
      opts: '{"attempts":3}',
      name: "__default__",
      timestamp: "1791574610210",
    },
  }),
  redis_command: () => ({ redis_version: "7.4.8", used_memory_human: "12.42M" }),
  redis_exec: () => "OK",
  redis_info: () => ({ redis_version: "7.4.8", dbsize: "1851", used_memory_human: "12.42M" }),
  mongo_collections: () => [
    { name: "events", count: 120404 },
    { name: "sessions", count: 9120 },
    { name: "users", count: 1420 },
  ],
  mongo_find: () => ({
    docs: Array.from({ length: 5 }, (_, i) => ({
      _id: { $oid: `66f1c2a3b4c5d6e7f8a9b${(100 + i).toString(16)}` },
      user: names[i],
      event: "page_view",
      path: "/pricing",
      ts: { $date: "2026-10-09T12:00:00Z" },
      props: { ref: "google", n: i },
    })),
    total: 120404,
  }),
  mongo_aggregate: () => [
    { _id: "page_view", n: 90210 },
    { _id: "signup", n: 1204 },
  ],
  mongo_collection_info: () => ({
    stats: {},
    indexes: [{ name: "_id_", keys: { _id: 1 }, unique: true }],
    fields: { _id: "objectId", user: "string", event: "string", ts: "date", props: "object" },
  }),
  get_settings: () => settings,
  save_settings: () => null,
  set_provider_key: () => null,
  has_provider_key: () => false,
  detect_clis: () => ({ claude: "/home/you/.local/bin/claude", codex: "/home/you/.local/bin/codex" }),
  kv_get: (a) =>
    a.name === "dashboards"
      ? [
          {
            id: "d1",
            connection_id: "pg",
            title: "Key metrics",
            charts: [
              chart,
              { ...chart, id: "c2", title: "Candidates by status", chart_type: "pie", x: "status", y: ["count"] },
              { ...chart, id: "c3", title: "Total observations", chart_type: "number", y: ["observations"] },
            ],
            created_at: "",
            updated_at: "",
          },
        ]
      : a.name === "history"
        ? [
            {
              id: "h1",
              connection_id: "pg",
              sql: 'SELECT * FROM "Candidate" LIMIT 100',
              ts: "",
              duration_ms: 12,
              ok: true,
              rows: 100,
            },
          ]
        : [],
  kv_set: () => null,
  history_add: () => null,
  ai_list_sessions: () => [{ ...session, messages: [] }],
  ai_get_session: () => session,
  ai_create_session: () => ({ ...session, id: "s2", title: "New chat", messages: [] }),
  ai_delete_session: () => null,
  ai_set_session_provider: () => null,
  ai_send: () => null,
  ai_cancel: () => null,
  ai_resolve_approval: () => null,
  run_chart: (a) => ((a.req as { source: { kind: string } }).source.kind === "sql" ? chartData : chartData),
  app_info: () => ({
    version: "0.1.0",
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
  let seq = 1;
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => seq++,
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd.startsWith("plugin:event|")) return seq++;
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
