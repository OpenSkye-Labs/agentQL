//! Tools exposed to the model (and over MCP). Everything here goes through
//! `db::Manager`, so API-key providers and CLI providers behave identically.

use super::{AgentEvent, ChatSession, Ctx, ToolDef};
use crate::config::{Driver, Note, ScopeEntry};
use crate::db::mongo::MongoFind;
use crate::db::sql::{
    SqlConn, SqlRefs, is_read_only, referenced_tables, split_statements, with_limit,
};
use crate::db::{Live, QueryResult};
use serde_json::{Value, json};
use tauri::Emitter;

/// The agent's allowed view of a SQL connection; `None` = unrestricted. Names compare exactly
/// (catalog spelling), except on SQLite where table names are case-insensitive.
/// ponytail: SQL only. Mongo/Redis stay unscoped until someone asks for db/collection scope.
struct Scope<'a> {
    entries: Option<&'a [ScopeEntry]>,
    fold: bool,
}

/// Always from the store, not the live session: the user can change the scope while connected.
fn stored_scope(ctx: &Ctx, connection_id: &str) -> Option<Vec<ScopeEntry>> {
    ctx.store
        .connections()
        .into_iter()
        .find(|c| c.id == connection_id)
        .and_then(|c| c.agent_scope)
}

impl<'a> Scope<'a> {
    fn new(entries: Option<&'a [ScopeEntry]>, driver: Driver) -> Self {
        Scope {
            entries,
            fold: driver == Driver::Sqlite,
        }
    }
    fn same(&self, a: &str, b: &str) -> bool {
        if self.fold {
            a.eq_ignore_ascii_case(b)
        } else {
            a == b
        }
    }
    fn schema_allowed(&self, schema: &str) -> bool {
        self.entries
            .is_none_or(|e| e.iter().any(|x| self.same(&x.schema, schema)))
    }
    fn table_allowed(&self, schema: &str, table: &str) -> bool {
        self.entries.is_none_or(|e| {
            e.iter().any(|x| {
                self.same(&x.schema, schema)
                    && x.table.as_deref().is_none_or(|t| self.same(t, table))
            })
        })
    }
}

/// Characters of notes in the system prompt; describe_table returns a table's notes in full.
const NOTES_BUDGET: usize = 6000;

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The user's data dictionary for in-scope tables as prompt lines: per table its note, then column notes, then
/// metrics, cut at `budget` characters with a marker. Empty when nothing is visible.
/// ponytail: a metric is visible when its anchor table is; one that joins an out-of-scope table still shows.
fn render_notes(notes: &[Note], scope: &Scope<'_>, budget: usize) -> String {
    let rank = |n: &Note| match (&n.column, &n.metric) {
        (None, None) => 0,
        (Some(_), _) => 1,
        _ => 2,
    };
    let mut visible: Vec<&Note> = notes
        .iter()
        .filter(|n| scope.table_allowed(&n.schema, &n.table))
        .collect();
    if visible.is_empty() {
        return String::new();
    }
    visible.sort_by(|a, b| {
        (&a.schema, &a.table, rank(a), &a.column, &a.metric).cmp(&(
            &b.schema,
            &b.table,
            rank(b),
            &b.column,
            &b.metric,
        ))
    });
    let mut body = String::new();
    let mut current: Option<(&str, &str)> = None;
    for n in visible {
        let mut chunk = String::new();
        if current != Some((&n.schema, &n.table)) {
            current = Some((&n.schema, &n.table));
            chunk.push_str(&format!("- {}.{}", n.schema, n.table));
            if rank(n) == 0 {
                chunk.push_str(&format!(": {}\n", one_line(&n.text)));
            } else {
                chunk.push('\n');
            }
        }
        match (&n.column, &n.metric) {
            (Some(c), _) => chunk.push_str(&format!("  - {c}: {}\n", one_line(&n.text))),
            (None, Some(m)) => chunk.push_str(&format!("  - metric {m} = {}\n", one_line(&n.text))),
            (None, None) => {}
        }
        if body.len() + chunk.len() > budget {
            body.push_str(
                "- … more notes truncated; describe_table returns a table's notes in full\n",
            );
            break;
        }
        body.push_str(&chunk);
    }
    format!(
        "\nData dictionary (notes the user wrote about meaning and metrics; prefer them over guesses from names):\n{body}"
    )
}

/// Functions that read data by name or run SQL from a string, so the parsed table list cannot see
/// what they touch. Refused while a scope is set.
/// ponytail: blocklist of the known Postgres/MySQL readers; the upgrade is an allowlist of pure functions.
const DYNAMIC_SQL_FUNCTIONS: &[&str] = &[
    "query_to_xml",
    "query_to_xmlschema",
    "query_to_xml_and_xmlschema",
    "table_to_xml",
    "table_to_xmlschema",
    "table_to_xml_and_xmlschema",
    "cursor_to_xml",
    "cursor_to_xmlschema",
    "schema_to_xml",
    "schema_to_xmlschema",
    "schema_to_xml_and_xmlschema",
    "database_to_xml",
    "database_to_xmlschema",
    "database_to_xml_and_xmlschema",
    "dblink",
    "dblink_exec",
    "dblink_open",
    "dblink_fetch",
    "dblink_get_result",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_stat_file",
    "pg_ls_dir",
    "pg_ls_logdir",
    "pg_ls_waldir",
    "ts_stat",
    "lo_get",
    "lo_open",
    "loread",
    "lo_import",
    "lo_export",
    "pg_logical_slot_get_changes",
    "pg_logical_slot_peek_changes",
    "load_file",
    // Changes search_path (and anything else) from inside a SELECT; SET statements are opaque already.
    "set_config",
];

const OUT_OF_SCOPE: &str = "is outside the agent scope for this connection (the user picks it with the Scope button in the assistant). Do not try to reach it another way.";

/// The parser-only half of the scope check: everything the parsed table list cannot vouch for is
/// refused before the database is asked anything. Fails closed on SQL that does not parse.
fn static_scope_check(driver: Driver, sql: &str) -> crate::error::Result<SqlRefs> {
    // MySQL runs `/*! ... */` and `/*+ ... */` comment bodies that the parser only sees as whitespace.
    if sql.contains("/*!") || sql.contains("/*+") {
        return Err(
            "executable comments (/*! */, /*+ */) are not allowed while an agent scope is set"
                .into(),
        );
    }
    let Some(refs) = referenced_tables(driver, sql) else {
        return Err("could not parse this SQL to check it against the agent scope; simplify it and qualify table names with their schema".into());
    };
    if let Some(st) = refs.opaque.first() {
        return Err(format!("{st} statements are not allowed while an agent scope is set; use list_tables / describe_table instead.").into());
    }
    if let Some(u) = refs.unsupported.first() {
        return Err(format!("{u} cannot be checked against the agent scope; rewrite with plain SELECT ... FROM schema.table, subqueries and joins.").into());
    }
    if let Some(f) = refs.functions.iter().find(|f| {
        let bare = f.rsplit('.').next().unwrap_or(f);
        // SQLite's pragma_* table functions read metadata of any table by name.
        DYNAMIC_SQL_FUNCTIONS.contains(&bare) || bare.starts_with("pragma_")
    }) {
        return Err(format!("{f}() reads data outside the parsed table list and is not allowed while an agent scope is set.").into());
    }
    Ok(refs)
}

/// Enforce the connection's agent scope on SQL the model wants to run, using the parsed table list.
/// Returns the `search_path` the statement must run under: on Postgres an unqualified name is taken
/// as `<current schema>.<name>`, must exist there, and execution pins that schema with `SET LOCAL`
/// so a `search_path` changed between check and run cannot redirect it. Other drivers have no such
/// pin, so unqualified names are refused there while a scope is set.
async fn check_sql_scope(
    c: &SqlConn,
    driver: Driver,
    scope: &Scope<'_>,
    sql: &str,
) -> crate::error::Result<Option<String>> {
    if scope.entries.is_none() {
        return Ok(None);
    }
    let refs = static_scope_check(driver, sql)?;
    let mut current: Option<(String, Vec<String>)> = None;
    for (schema, table) in refs.tables {
        let ok = match schema.as_deref() {
            Some(sch) => scope.table_allowed(sch, &table),
            None if driver != Driver::Postgres => {
                return Err(format!("'{table}' is unqualified; while an agent scope is set, write it as <schema>.{table} (see list_tables).").into());
            }
            None => {
                if current.is_none() {
                    let cs = c.current_schema().await?;
                    let names = c.tables(&cs).await?.into_iter().map(|t| t.name).collect();
                    current = Some((cs, names));
                }
                let (cs, names) = current.as_ref().expect("set above");
                names.iter().any(|n| scope.same(n, &table)) && scope.table_allowed(cs, &table)
            }
        };
        if !ok {
            let full = schema.map(|s| format!("{s}.{table}")).unwrap_or(table);
            return Err(
                format!("'{full}' {OUT_OF_SCOPE} Qualify table names with their schema.").into(),
            );
        }
    }
    Ok(current.map(|(cs, _)| cs))
}

/// Default schema for unqualified calls: the first one the agent may see.
async fn default_schema(c: &SqlConn, scope: &Scope<'_>) -> crate::error::Result<String> {
    Ok(c.schemas()
        .await?
        .into_iter()
        .find(|s| scope.schema_allowed(s))
        .unwrap_or_default())
}

/// Chart sources run SQL on the agent's behalf too: same scope check, same audit trail.
async fn run_agent_chart(
    ctx: &Ctx,
    session: &ChatSession,
    conn: &crate::db::Session,
    scope: &Scope<'_>,
    source: &Value,
) -> crate::error::Result<QueryResult> {
    let (sql, search_path) = match (&conn.live, source.get("sql").and_then(|s| s.as_str())) {
        (Live::Sql(c), Some(sql)) => (
            Some(sql),
            check_sql_scope(c, conn.config.driver, scope, sql).await?,
        ),
        _ => (None, None),
    };
    let started = std::time::Instant::now();
    let res = run_chart_source(ctx, &session.connection_id, source, search_path.as_deref())
        .await
        .map(|r| vec![r]);
    if let Some(sql) = sql {
        record_history(ctx, session, sql, started.elapsed().as_millis(), &res);
    }
    res.map(|mut v| v.remove(0))
}

/// Every statement the agent executes lands in the normal query history, tagged with the session.
fn record_history(
    ctx: &Ctx,
    session: &ChatSession,
    sql: &str,
    ms: u128,
    res: &crate::error::Result<Vec<QueryResult>>,
) {
    let mut entry = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "connection_id": session.connection_id,
        "sql": sql,
        "ts": chrono::Utc::now().to_rfc3339(),
        "duration_ms": ms,
        "ok": res.is_ok(),
        "source": "agent",
        "session_id": session.id,
    });
    if let Ok(results) = res {
        entry["rows"] = json!(results.iter().map(|r| r.rows.len()).sum::<usize>());
    }
    if ctx.store.push_history(entry.clone()).is_ok() {
        let _ = ctx.app.emit("history:added", &entry);
    }
}

pub struct ToolOutput {
    pub content: String,
    pub is_error: bool,
    pub display: Option<Value>,
}

fn ok(content: String, display: Option<Value>) -> ToolOutput {
    ToolOutput {
        content,
        is_error: false,
        display,
    }
}
fn err(msg: impl ToString) -> ToolOutput {
    ToolOutput {
        content: msg.to_string(),
        is_error: true,
        display: None,
    }
}

const CHART_PROPS: &str = r#"{
  "title": {"type": "string"},
  "description": {"type": "string", "description": "One sentence on what the chart shows"},
  "chart_type": {"type": "string", "enum": ["bar", "line", "area", "pie", "number", "table"]},
  "x": {"type": "string", "description": "Column for the x axis / category (omit for number)"},
  "y": {"type": "array", "items": {"type": "string"}, "description": "Numeric column(s) to plot"},
  "sql": {"type": "string", "description": "SQL query returning the chart data (SQL connections)"},
  "mongo": {"type": "object", "description": "Mongo source instead of sql", "properties": {"db": {"type": "string"}, "collection": {"type": "string"}, "pipeline": {"type": "array"}}}
}"#;

pub fn definitions(driver: Driver) -> Vec<ToolDef> {
    let t = |name: &str, desc: &str, props: Value, required: &[&str]| ToolDef {
        name: name.into(),
        description: desc.into(),
        input_schema: json!({"type": "object", "properties": props, "required": required}),
    };
    let chart_props: Value = serde_json::from_str(CHART_PROPS).unwrap();
    let mut defs = vec![];
    if driver.is_sql() {
        defs.extend([
            t("list_schemas", "List schemas (databases for MySQL) available on this connection.", json!({}), &[]),
            t("list_tables", "List tables and views in a schema with approximate row counts.", json!({"schema": {"type": "string"}}), &["schema"]),
            t(
                "describe_table",
                "Columns (name, type, nullable, default, primary key), indexes, foreign keys and DDL of a table.",
                json!({"schema": {"type": "string"}, "table": {"type": "string"}}),
                &["table"],
            ),
            t(
                "run_sql",
                "Execute SQL on the user's database and return the rows. Prefer SELECT; write statements require user approval and may be disabled. Always add a LIMIT when exploring.",
                json!({"sql": {"type": "string"}, "limit": {"type": "integer", "description": "max rows to return (default 200)"}}),
                &["sql"],
            ),
            t(
                "save_note",
                "Propose a data-dictionary note: what a table or a column means (enum values, units, caveats), or a named \
                 metric (set `metric` to its name and `text` to its SQL definition). The user approves it first; it is stored in \
                 AgentQL, never in the database. Empty text deletes the note.",
                json!({"schema": {"type": "string"}, "table": {"type": "string"}, "column": {"type": "string"}, "metric": {"type": "string"}, "text": {"type": "string"}}),
                &["table", "text"],
            ),
            t(
                "explain_sql",
                "Return the database's execution plan for a query (EXPLAIN). Use to optimise queries; set analyze=true to actually run it and get real timings (read-only queries only).",
                json!({"sql": {"type": "string"}, "analyze": {"type": "boolean"}}),
                &["sql"],
            ),
        ]);
    }
    if driver == Driver::Redis {
        defs.extend([
            t("redis_scan", "Scan keys matching a glob pattern with their types and TTLs.", json!({"pattern": {"type": "string"}, "count": {"type": "integer"}}), &[]),
            t(
                "redis_command",
                "Run a Redis command (e.g. 'HGETALL user:1', 'INFO memory'). Only read commands run without approval.",
                json!({"command": {"type": "string"}}),
                &["command"],
            ),
        ]);
    }
    if driver == Driver::Mongodb {
        defs.extend([
            t("list_databases", "List MongoDB databases.", json!({}), &[]),
            t("list_collections", "List collections in a database with estimated counts.", json!({"db": {"type": "string"}}), &["db"]),
            t("describe_collection", "Sampled field names/types, indexes and stats of a collection.", json!({"db": {"type": "string"}, "collection": {"type": "string"}}), &["db", "collection"]),
            t(
                "mongo_find",
                "Find documents. filter/sort/projection are MongoDB query documents (extended JSON allowed).",
                json!({"db": {"type": "string"}, "collection": {"type": "string"}, "filter": {"type": "object"}, "sort": {"type": "object"}, "projection": {"type": "object"}, "limit": {"type": "integer"}}),
                &["db", "collection"],
            ),
            t(
                "mongo_aggregate",
                "Run an aggregation pipeline (array of stages) and return the resulting documents.",
                json!({"db": {"type": "string"}, "collection": {"type": "string"}, "pipeline": {"type": "array"}, "limit": {"type": "integer"}}),
                &["db", "collection", "pipeline"],
            ),
        ]);
    }
    if driver != Driver::Redis {
        defs.push(t(
            "create_chart",
            "Run a query and render it as a chart card in the chat. The user can add it to a dashboard. Use for any visual answer.",
            chart_props.clone(),
            &["title", "chart_type"],
        ));
        defs.push(t(
            "propose_dashboard",
            "Build a whole dashboard from several chart definitions; each chart is validated by running its query. The user can save it with one click.",
            json!({"title": {"type": "string"}, "description": {"type": "string"}, "charts": {"type": "array", "items": {"type": "object", "properties": chart_props}}}),
            &["title", "charts"],
        ));
    }
    defs
}

/// Appended to the system prompt when the `vector` extension is installed.
const PGVECTOR_GUIDE: &str = "\npgvector is installed. Vector cells arrive as JSON float arrays. \
    Distance operators: <-> L2, <=> cosine, <#> negative inner product, <+> L1 (pgvector 0.7+ only); the operator must match the index \
    opclass (vector_l2_ops / vector_cosine_ops / vector_ip_ops) and the query must be `ORDER BY col <op> q LIMIT k` for \
    the index to be used (describe_table shows the index method and options). \
    Tuning per session: SET hnsw.ef_search = N; SET ivfflat.probes = N. \
    For experiments: measure recall by comparing the indexed top-k with an exact scan (SET LOCAL enable_indexscan = off), \
    time both with explain_sql, check vector_dims(col) and vector_norm(col), find a row's neighbours with a subquery on its id, \
    and near-duplicates with a self-join under a distance threshold. \
    Never select whole vector columns for many rows; project dims/norm/distance or LIMIT a handful.\n";

pub async fn system_prompt(ctx: &Ctx, session: &ChatSession) -> String {
    let Ok(conn) = ctx.manager.get(&session.connection_id).await else {
        return "You are AgentQL, a database assistant. The connection is currently offline."
            .into();
    };
    let cfg = &conn.config;
    let mut s = format!(
        "You are AgentQL, an expert database assistant embedded in a desktop SQL client. \
         You are connected to a {} database named '{}' (connection '{}').\n\
         Use the tools to inspect schema and run queries before answering; never guess table or column names. \
         When you write SQL, use the {} dialect and put it in a ```sql fenced block so the user can insert it into the editor. \
         Keep answers concise. When the user asks for a visual or a dashboard, use create_chart / propose_dashboard. \
         For optimisation requests, call explain_sql, then explain the plan and propose a rewritten query and/or indexes.\n",
        cfg.driver.label(),
        cfg.database,
        cfg.name,
        cfg.driver.label()
    );
    if cfg.read_only {
        s.push_str("This connection is READ-ONLY: never attempt write statements.\n");
    }
    match &conn.live {
        Live::Sql(c) => {
            let scope_entries = stored_scope(ctx, &session.connection_id);
            let scope = Scope::new(scope_entries.as_deref(), cfg.driver);
            if scope_entries.is_some() {
                s.push_str(
                    "The user limited your view of this database to the schemas and tables listed below. \
                     Never query anything else (including information_schema or pg_catalog); use describe_table for metadata.\n",
                );
            }
            if cfg.driver == Driver::Postgres
                && c.run_one_read_only("SELECT 1 FROM pg_extension WHERE extname = 'vector'", 1)
                    .await
                    .is_ok_and(|r| !r.rows.is_empty())
            {
                s.push_str(PGVECTOR_GUIDE);
            }
            if let Ok(schemas) = c.schemas().await {
                s.push_str("\nSchemas and tables:\n");
                let mut budget = 150usize;
                for schema in schemas.iter().filter(|x| scope.schema_allowed(x)).take(10) {
                    if let Ok(tables) = c.tables(schema).await {
                        let visible: Vec<&str> = tables
                            .iter()
                            .filter(|t| scope.table_allowed(schema, &t.name))
                            .map(|t| t.name.as_str())
                            .collect();
                        let names = &visible[..visible.len().min(budget)];
                        budget = budget.saturating_sub(names.len());
                        s.push_str(&format!(
                            "- {schema}: {}{}\n",
                            names.join(", "),
                            if visible.len() > names.len() {
                                ", …"
                            } else {
                                ""
                            }
                        ));
                    }
                    if budget == 0 {
                        break;
                    }
                }
            }
            match ctx.store.notes(&session.connection_id) {
                Ok(notes) => s.push_str(&render_notes(&notes, &scope, NOTES_BUDGET)),
                Err(e) => s.push_str(&format!(
                    "\nThe user's data dictionary could not be read: {e}\n"
                )),
            }
        }
        Live::Mongo(m) => {
            if let Ok(dbs) = m.databases().await {
                s.push_str(&format!("\nDatabases: {}\n", dbs.join(", ")));
                if let Some(db) = m.default_db.as_deref().or(dbs.first().map(|x| x.as_str()))
                    && let Ok(cols) = m.collections(db).await
                {
                    let names: Vec<String> = cols
                        .iter()
                        .filter_map(|c| c["name"].as_str().map(|s| s.to_string()))
                        .collect();
                    s.push_str(&format!("Collections in {db}: {}\n", names.join(", ")));
                }
            }
        }
        Live::Redis(r) => {
            if let Ok(info) = r.info().await {
                s.push_str(&format!(
                    "\nRedis {} · {} keys · used memory {}\n",
                    info["redis_version"].as_str().unwrap_or("?"),
                    info["dbsize"],
                    info["used_memory_human"].as_str().unwrap_or("?")
                ));
            }
        }
    }
    s
}

fn str_arg<'a>(input: &'a Value, k: &str) -> Option<&'a str> {
    input
        .get(k)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
}

pub async fn execute(ctx: &Ctx, session: &ChatSession, name: &str, input: &Value) -> ToolOutput {
    match execute_inner(ctx, session, name, input).await {
        Ok(o) => o,
        Err(e) => err(e),
    }
}

async fn execute_inner(
    ctx: &Ctx,
    session: &ChatSession,
    name: &str,
    input: &Value,
) -> crate::error::Result<ToolOutput> {
    let conn = ctx.manager.get(&session.connection_id).await?;
    let settings = ctx.store.settings();
    let writes_allowed = settings.agent_allow_writes && !conn.config.read_only;
    let scope_entries = stored_scope(ctx, &session.connection_id);
    let scope = Scope::new(scope_entries.as_deref(), conn.config.driver);

    match (&conn.live, name) {
        (Live::Sql(c), "list_schemas") => {
            let schemas: Vec<String> = c
                .schemas()
                .await?
                .into_iter()
                .filter(|s| scope.schema_allowed(s))
                .collect();
            Ok(ok(serde_json::to_string(&schemas)?, None))
        }
        (Live::Sql(c), "list_tables") => {
            let schema = match str_arg(input, "schema") {
                Some(s) => s.to_string(),
                None => default_schema(c, &scope).await?,
            };
            if !scope.schema_allowed(&schema) {
                return Ok(err(format!("schema '{schema}' {OUT_OF_SCOPE}")));
            }
            let tables = c.tables(&schema).await?;
            let lines: Vec<String> = tables
                .iter()
                .filter(|t| scope.table_allowed(&schema, &t.name))
                .map(|t| {
                    format!(
                        "{} ({}{})",
                        t.name,
                        t.kind,
                        t.row_estimate
                            .map(|n| format!(", ~{n} rows"))
                            .unwrap_or_default()
                    )
                })
                .collect();
            Ok(ok(lines.join("\n"), None))
        }
        (Live::Sql(c), "describe_table") => {
            let table = str_arg(input, "table").ok_or("table is required")?;
            let schema = match str_arg(input, "schema") {
                Some(s) => s.to_string(),
                None => default_schema(c, &scope).await?,
            };
            if !scope.table_allowed(&schema, table) {
                return Ok(err(format!("'{schema}.{table}' {OUT_OF_SCOPE}")));
            }
            let d = c.table_details(&schema, table).await?;
            let (notes, notes_err): (Vec<Note>, _) = match ctx.store.notes(&session.connection_id) {
                Ok(all) => (
                    all.into_iter()
                        .filter(|n| scope.same(&n.schema, &schema) && scope.same(&n.table, table))
                        .collect(),
                    None,
                ),
                Err(e) => (vec![], Some(e)),
            };
            let col_note = |col: &str| {
                notes
                    .iter()
                    .find(|n| n.column.as_deref().is_some_and(|c| scope.same(c, col)))
                    .map(|n| format!(" -- {}", one_line(&n.text)))
                    .unwrap_or_default()
            };
            let mut s = format!("Table {schema}.{table}\nColumns:\n");
            for col in &d.columns {
                s.push_str(&format!(
                    "- {} {}{}{}{}{}\n",
                    col.name,
                    col.data_type,
                    if col.is_primary { " PK" } else { "" },
                    if col.nullable { "" } else { " NOT NULL" },
                    col.default
                        .as_ref()
                        .map(|v| format!(" DEFAULT {v}"))
                        .unwrap_or_default(),
                    col_note(&col.name)
                ));
            }
            if !d.indexes.is_empty() {
                s.push_str("Indexes:\n");
                for i in &d.indexes {
                    // Non-btree indexes (hnsw, ivfflat, gin, gist …) print method, opclasses and options, all from the
                    // catalog so a quoted name containing "USING" cannot mislead the output.
                    match i.method.as_deref().filter(|m| *m != "btree") {
                        Some(m) => {
                            let cols: Vec<String> = i
                                .columns
                                .iter()
                                .enumerate()
                                .map(|(k, c)| match i.opclasses.get(k) {
                                    Some(oc) => format!("{c} {oc}"),
                                    None => c.clone(),
                                })
                                .collect();
                            s.push_str(&format!(
                                "- {} USING {m} ({}){}{}\n",
                                i.name,
                                cols.join(", "),
                                if i.options.is_empty() {
                                    String::new()
                                } else {
                                    format!(" WITH ({})", i.options.join(", "))
                                },
                                if i.unique { " UNIQUE" } else { "" }
                            ));
                        }
                        None => s.push_str(&format!(
                            "- {} ({}){}\n",
                            i.name,
                            i.columns.join(", "),
                            if i.unique { " UNIQUE" } else { "" }
                        )),
                    }
                }
            }
            if !d.foreign_keys.is_empty() {
                s.push_str("Foreign keys:\n");
                for f in &d.foreign_keys {
                    s.push_str(&format!(
                        "- {} ({}) -> {}({})\n",
                        f.name,
                        f.columns.join(", "),
                        f.ref_table,
                        f.ref_columns.join(", ")
                    ));
                }
            }
            let mut table_level: Vec<&Note> = notes.iter().filter(|n| n.column.is_none()).collect();
            table_level.sort_by_key(|n| &n.metric);
            if let Some(e) = notes_err {
                s.push_str(&format!("Notes could not be read: {e}\n"));
            }
            if !table_level.is_empty() {
                s.push_str("Notes (from the user's data dictionary):\n");
                for n in table_level {
                    match &n.metric {
                        Some(m) => s.push_str(&format!("- metric {m} = {}\n", one_line(&n.text))),
                        None => s.push_str(&format!("- {}\n", one_line(&n.text))),
                    }
                }
            }
            Ok(ok(
                s,
                Some(
                    json!({"type": "table_details", "schema": schema, "table": table, "details": d}),
                ),
            ))
        }
        (Live::Sql(c), "save_note") => {
            let table = str_arg(input, "table").ok_or("table is required")?;
            let schema = match str_arg(input, "schema") {
                Some(s) => s.to_string(),
                None => default_schema(c, &scope).await?,
            };
            if !scope.table_allowed(&schema, table) {
                return Ok(err(format!("'{schema}.{table}' {OUT_OF_SCOPE}")));
            }
            let note = Note {
                schema: schema.clone(),
                table: table.to_string(),
                column: str_arg(input, "column").map(str::to_string),
                metric: str_arg(input, "metric").map(str::to_string),
                text: input
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            };
            if note.column.is_some() && note.metric.is_some() {
                return Ok(err("Set either column or metric, not both."));
            }
            // Notes on tables or columns that do not exist would only mislead later turns.
            let d = c.table_details(&schema, table).await?;
            if d.columns.is_empty() {
                return Ok(err(format!(
                    "'{schema}.{table}' does not exist; check list_tables."
                )));
            }
            if let Some(col) = &note.column
                && !d.columns.iter().any(|x| scope.same(&x.name, col))
            {
                return Ok(err(format!("'{schema}.{table}' has no column '{col}'.")));
            }
            let target = match (&note.column, &note.metric) {
                (Some(col), _) => format!("Column {schema}.{table}.{col}"),
                (None, Some(m)) => format!("Metric '{m}' on {schema}.{table}"),
                (None, None) => format!("Table {schema}.{table}"),
            };
            let shown = if note.text.is_empty() {
                "(delete this note)"
            } else {
                note.text.as_str()
            };
            if !ctx
                .request_decision(
                    &session.id,
                    "note",
                    "The agent wants to save a data-dictionary note",
                    &format!("{target}\n\n{shown}"),
                )
                .await
            {
                return Ok(err("The user declined to save this note."));
            }
            // The scope may have been narrowed while the card was waiting.
            let fresh = stored_scope(ctx, &session.connection_id);
            if !Scope::new(fresh.as_deref(), conn.config.driver).table_allowed(&schema, table) {
                return Ok(err(format!("'{schema}.{table}' {OUT_OF_SCOPE}")));
            }
            ctx.store.save_note(&session.connection_id, note)?;
            let _ = ctx.app.emit("notes:changed", &session.connection_id);
            Ok(ok(format!("Saved the note for {target}."), None))
        }
        (Live::Sql(c), "run_sql") => {
            let sql = str_arg(input, "sql").ok_or("sql is required")?;
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(200)
                .min(2000) as u32;
            let mut search_path = check_sql_scope(c, conn.config.driver, &scope, sql).await?;
            let read_only = is_read_only(conn.config.driver, sql);
            if !read_only {
                if !writes_allowed {
                    return Ok(err(
                        "This statement writes data. Writes by the agent are disabled (Settings → AI → allow writes), or the connection is read-only. Ask the user to run it themselves by giving them the SQL.",
                    ));
                }
                if !ctx
                    .request_approval(&session.id, "The agent wants to run a write statement", sql)
                    .await
                {
                    return Ok(err("The user declined to run this statement."));
                }
                // The scope may have been narrowed while the card was waiting.
                let fresh = stored_scope(ctx, &session.connection_id);
                let scope = Scope::new(fresh.as_deref(), conn.config.driver);
                search_path = check_sql_scope(c, conn.config.driver, &scope, sql).await?;
            }
            // Bare SELECTs get the row cap pushed into the database so it stops scanning early;
            // one extra row so the client-side `truncated` flag still fires.
            let sql = split_statements(sql)
                .iter()
                .map(|st| with_limit(conn.config.driver, st, limit + 1))
                .collect::<Vec<_>>()
                .join("\n;\n");
            let started = std::time::Instant::now();
            let res = c
                .run_with_search_path(&sql, limit, read_only, search_path.as_deref())
                .await;
            record_history(ctx, session, &sql, started.elapsed().as_millis(), &res);
            let results = res?;
            let mut text = String::new();
            for r in &results {
                text.push_str(&format_result(r, 50));
                text.push('\n');
            }
            Ok(ok(
                text,
                Some(json!({"type": "query_results", "results": results})),
            ))
        }
        (Live::Sql(c), "explain_sql") => {
            let sql = str_arg(input, "sql").ok_or("sql is required")?;
            let analyze = input
                .get("analyze")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let search_path = check_sql_scope(c, conn.config.driver, &scope, sql).await?;
            if analyze && !is_read_only(conn.config.driver, sql) {
                return Ok(err(
                    "EXPLAIN ANALYZE would execute a write statement; run plain explain instead.",
                ));
            }
            let stmt = split_statements(sql).into_iter().next().unwrap_or_default();
            let explain = c.explain_sql(&stmt, analyze);
            let started = std::time::Instant::now();
            let res = c
                .run_with_search_path(&explain, 5000, true, search_path.as_deref())
                .await;
            record_history(ctx, session, &explain, started.elapsed().as_millis(), &res);
            let r = res?.into_iter().next().ok_or("EXPLAIN returned nothing")?;
            let plan: Vec<String> = r
                .rows
                .iter()
                .map(|row| row.iter().map(cell_text).collect::<Vec<_>>().join(" | "))
                .collect();
            Ok(ok(
                plan.join("\n"),
                Some(json!({"type": "plan", "plan": plan.join("\n")})),
            ))
        }
        (Live::Redis(r), "redis_scan") => {
            let pattern = str_arg(input, "pattern").unwrap_or("*");
            let count = input
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(100)
                .min(1000) as u32;
            let res = r.scan("0", pattern, count).await?;
            let lines: Vec<String> = res
                .keys
                .iter()
                .map(|k| format!("{} ({}, ttl {})", k.key, k.kind, k.ttl))
                .collect();
            Ok(ok(
                format!("{}\nnext cursor: {}", lines.join("\n"), res.cursor),
                None,
            ))
        }
        (Live::Redis(r), "redis_command") => {
            let cmd = str_arg(input, "command").ok_or("command is required")?;
            if !crate::db::redis::is_read_only_command(cmd) {
                if !writes_allowed {
                    return Ok(err(
                        "Only read commands are allowed for the agent on this connection.",
                    ));
                }
                if !ctx
                    .request_approval(
                        &session.id,
                        "The agent wants to run a Redis write command",
                        cmd,
                    )
                    .await
                {
                    return Ok(err("The user declined to run this command."));
                }
            }
            let v = r.command(cmd).await?;
            Ok(ok(
                truncate(&serde_json::to_string_pretty(&v)?, 8000),
                Some(json!({"type": "json", "value": v})),
            ))
        }
        (Live::Mongo(m), "list_databases") => Ok(ok(m.databases().await?.join("\n"), None)),
        (Live::Mongo(m), "list_collections") => {
            let db = str_arg(input, "db")
                .map(str::to_string)
                .or_else(|| m.default_db.clone())
                .ok_or("db is required")?;
            let cols = m.collections(&db).await?;
            Ok(ok(
                cols.iter()
                    .map(|c| {
                        format!(
                            "{} (~{} docs)",
                            c["name"].as_str().unwrap_or("?"),
                            c["count"]
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                None,
            ))
        }
        (Live::Mongo(m), "describe_collection") => {
            let db = str_arg(input, "db")
                .map(str::to_string)
                .or_else(|| m.default_db.clone())
                .ok_or("db is required")?;
            let coll = str_arg(input, "collection").ok_or("collection is required")?;
            let info = m.collection_info(&db, coll).await?;
            Ok(ok(
                truncate(
                    &serde_json::to_string_pretty(
                        &json!({"fields": info["fields"], "indexes": info["indexes"]}),
                    )?,
                    8000,
                ),
                Some(json!({"type": "json", "value": info})),
            ))
        }
        (Live::Mongo(m), "mongo_find") => {
            let db = str_arg(input, "db")
                .map(str::to_string)
                .or_else(|| m.default_db.clone())
                .ok_or("db is required")?;
            let q = MongoFind {
                db,
                collection: str_arg(input, "collection")
                    .ok_or("collection is required")?
                    .to_string(),
                filter: input.get("filter").cloned(),
                sort: input.get("sort").cloned(),
                projection: input.get("projection").cloned(),
                limit: input
                    .get("limit")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(20)
                    .min(500),
                skip: 0,
            };
            let page = m.find(&q).await?;
            let text = format!(
                "{} matching (showing {}):\n{}",
                page.total.map(|t| t.to_string()).unwrap_or("?".into()),
                page.docs.len(),
                truncate(&serde_json::to_string_pretty(&page.docs)?, 8000)
            );
            Ok(ok(
                text,
                Some(json!({"type": "documents", "docs": page.docs})),
            ))
        }
        (Live::Mongo(m), "mongo_aggregate") => {
            let db = str_arg(input, "db")
                .map(str::to_string)
                .or_else(|| m.default_db.clone())
                .ok_or("db is required")?;
            let coll = str_arg(input, "collection").ok_or("collection is required")?;
            let pipeline = input.get("pipeline").ok_or("pipeline is required")?;
            if pipeline_writes(pipeline) {
                if !writes_allowed {
                    return Ok(err(
                        "$out / $merge stages write data; agent writes are disabled.",
                    ));
                }
                if !ctx
                    .request_approval(
                        &session.id,
                        "The agent wants to run a writing aggregation ($out/$merge)",
                        &pipeline.to_string(),
                    )
                    .await
                {
                    return Ok(err("The user declined to run this pipeline."));
                }
            }
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(100)
                .min(2000) as usize;
            let docs = m.aggregate(&db, coll, pipeline, limit).await?;
            Ok(ok(
                truncate(&serde_json::to_string_pretty(&docs)?, 8000),
                Some(json!({"type": "documents", "docs": docs})),
            ))
        }
        (_, "create_chart") => {
            let spec = chart_spec(input, &conn.config.driver)?;
            let data = run_agent_chart(ctx, session, &conn, &scope, &spec["source"]).await?;
            let summary = format!(
                "Chart '{}' ready: {} rows, columns {}",
                spec["title"].as_str().unwrap_or(""),
                data.rows.len(),
                data.columns
                    .iter()
                    .map(|c| c.name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            Ok(ok(
                summary,
                Some(json!({"type": "chart", "spec": spec, "data": data})),
            ))
        }
        (_, "propose_dashboard") => {
            let title = str_arg(input, "title").unwrap_or("Dashboard");
            let charts = input
                .get("charts")
                .and_then(|c| c.as_array())
                .ok_or("charts must be an array")?;
            let mut out = vec![];
            let mut notes = vec![];
            for c in charts {
                let spec = chart_spec(c, &conn.config.driver)?;
                match run_agent_chart(ctx, session, &conn, &scope, &spec["source"]).await {
                    Ok(data) => {
                        notes.push(format!(
                            "✓ {} ({} rows)",
                            spec["title"].as_str().unwrap_or(""),
                            data.rows.len()
                        ));
                        out.push(json!({"spec": spec, "data": data}));
                    }
                    Err(e) => {
                        notes.push(format!("✗ {}: {e}", spec["title"].as_str().unwrap_or("")))
                    }
                }
            }
            Ok(ok(
                format!(
                    "Dashboard '{title}' with {} charts:\n{}",
                    out.len(),
                    notes.join("\n")
                ),
                Some(
                    json!({"type": "dashboard", "title": title, "description": input.get("description"), "charts": out}),
                ),
            ))
        }
        _ => Ok(err(format!(
            "unknown tool '{name}' for this connection type"
        ))),
    }
}

use crate::db::mongo::pipeline_writes;

/// Normalised chart spec stored in dashboards: {title, description, chart_type, x, y[], source}.
pub fn chart_spec(input: &Value, driver: &Driver) -> crate::error::Result<Value> {
    let source = if let Some(sql) = str_arg(input, "sql") {
        json!({"kind": "sql", "sql": sql})
    } else if let Some(m) = input.get("mongo") {
        json!({"kind": "mongo", "db": m.get("db"), "collection": m.get("collection"), "pipeline": m.get("pipeline").cloned().unwrap_or(json!([]))})
    } else if driver.is_sql() {
        return Err("chart needs a sql query".into());
    } else {
        return Err("chart needs a mongo source".into());
    };
    Ok(json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "title": str_arg(input, "title").unwrap_or("Untitled"),
        "description": input.get("description"),
        "chart_type": str_arg(input, "chart_type").unwrap_or("table"),
        "x": input.get("x"),
        "y": input.get("y").cloned().unwrap_or(json!([])),
        "source": source,
    }))
}

/// Execute a chart source and return tabular data. Shared by the agent and the dashboards page.
/// Chart sources are always read-only (classifier + database-enforced).
pub async fn run_chart_source(
    ctx: &Ctx,
    connection_id: &str,
    source: &Value,
    search_path: Option<&str>,
) -> crate::error::Result<QueryResult> {
    let conn = ctx.manager.get(connection_id).await?;
    match (&conn.live, source.get("kind").and_then(|k| k.as_str())) {
        (Live::Sql(c), Some("sql")) => {
            let sql = source
                .get("sql")
                .and_then(|s| s.as_str())
                .ok_or("missing sql")?;
            if !is_read_only(conn.config.driver, sql) {
                return Err("chart queries must be read-only".into());
            }
            let mut results = c.run_with_search_path(sql, 5000, true, search_path).await?;
            results.pop().ok_or_else(|| "query returned nothing".into())
        }
        (Live::Mongo(m), Some("mongo")) => {
            let db = source
                .get("db")
                .and_then(|s| s.as_str())
                .map(str::to_string)
                .or_else(|| m.default_db.clone())
                .ok_or("missing db")?;
            let coll = source
                .get("collection")
                .and_then(|s| s.as_str())
                .ok_or("missing collection")?;
            let pipeline = source.get("pipeline").ok_or("missing pipeline")?;
            if pipeline_writes(pipeline) {
                return Err("chart pipelines must be read-only".into());
            }
            let docs = m.aggregate(&db, coll, pipeline, 5000).await?;
            Ok(docs_to_table(&docs))
        }
        _ => Err("chart source does not match the connection type".into()),
    }
}

pub fn docs_to_table(docs: &[Value]) -> QueryResult {
    let mut cols: Vec<String> = vec![];
    for d in docs {
        if let Some(o) = d.as_object() {
            for k in o.keys() {
                if !cols.contains(k) {
                    cols.push(k.clone());
                }
            }
        }
    }
    QueryResult {
        columns: cols
            .iter()
            .map(|c| crate::db::Column {
                name: c.clone(),
                type_name: "bson".into(),
            })
            .collect(),
        rows: docs
            .iter()
            .map(|d| {
                cols.iter()
                    .map(|c| d.get(c).cloned().unwrap_or(Value::Null))
                    .collect()
            })
            .collect(),
        ..Default::default()
    }
}

fn cell_text(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Compact markdown rendering for the model.
pub fn format_result(r: &QueryResult, max_rows: usize) -> String {
    if r.columns.is_empty() {
        return format!(
            "OK, {} row(s) affected ({} ms)",
            r.affected.unwrap_or(0),
            r.duration_ms
        );
    }
    let mut s = String::new();
    s.push_str(&format!(
        "| {} |\n",
        r.columns
            .iter()
            .map(|c| c.name.replace('|', "\\|"))
            .collect::<Vec<_>>()
            .join(" | ")
    ));
    s.push_str(&format!(
        "|{}|\n",
        r.columns
            .iter()
            .map(|_| "---")
            .collect::<Vec<_>>()
            .join("|")
    ));
    for row in r.rows.iter().take(max_rows) {
        s.push_str(&format!(
            "| {} |\n",
            row.iter()
                .map(|v| truncate(&cell_text(v), 120)
                    .replace('|', "\\|")
                    .replace('\n', " "))
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    if r.rows.len() > max_rows {
        s.push_str(&format!(
            "… {} more rows not shown\n",
            r.rows.len() - max_rows
        ));
    }
    s.push_str(&format!(
        "({} rows{}, {} ms)",
        r.rows.len(),
        if r.truncated { ", truncated" } else { "" },
        r.duration_ms
    ));
    s
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

/// Used by the MCP server: run a tool for a session and mirror events to the UI.
pub async fn execute_for_mcp(ctx: &Ctx, session_id: &str, name: &str, input: &Value) -> ToolOutput {
    let session = match ctx.load_session(session_id) {
        Ok(s) => s,
        Err(e) => return err(e),
    };
    let id = uuid::Uuid::new_v4().to_string();
    ctx.emit(
        session_id,
        &AgentEvent::ToolCall {
            id: id.clone(),
            name: name.into(),
            input: input.clone(),
        },
    );
    let out = execute(ctx, &session, name, input).await;
    ctx.emit(
        session_id,
        &AgentEvent::ToolResult {
            id: id.clone(),
            content: out.content.clone(),
            is_error: out.is_error,
            display: out.display.clone(),
        },
    );
    // Persist the call on the session so the transcript survives reloads.
    if let Ok(mut s) = ctx.load_session(session_id) {
        s.messages.push(super::Message::new(
            "assistant",
            vec![super::Block::ToolUse {
                id: id.clone(),
                name: name.into(),
                input: input.clone(),
            }],
        ));
        s.messages.push(super::Message::new(
            "user",
            vec![super::Block::ToolResult {
                tool_use_id: id,
                content: out.content.clone(),
                is_error: out.is_error,
                display: out.display.clone(),
            }],
        ));
        let _ = ctx.save_session(&mut s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The parser-only half of the scope check refuses every known bypass before touching the database.
    #[test]
    fn static_scope_check_refuses_bypasses() {
        let pg = Driver::Postgres;
        for sql in [
            "TABLE other.secrets",
            "with x as (table other.secrets) select * from x",
            "select * from lateral pg_read_file('/etc/passwd') f",
            "SET search_path TO other",
            "select set_config('search_path', 'other', false)",
            "select pg_catalog.set_config('search_path', 'other', false)",
            "select * from t pivot (sum(x) for y in ('a'))",
            "show tables",
            "select /*! 1 */ * from t",
            "select * from",
        ] {
            assert!(static_scope_check(pg, sql).is_err(), "{sql}");
        }
        let ok =
            static_scope_check(pg, "select * from public.t, lateral jsonb_each(t.doc) x").unwrap();
        assert_eq!(ok.tables, vec![(Some("public".into()), "t".into())]);
    }

    fn n(table: &str, column: Option<&str>, metric: Option<&str>, text: &str) -> Note {
        Note {
            schema: "public".into(),
            table: table.into(),
            column: column.map(Into::into),
            metric: metric.map(Into::into),
            text: text.into(),
        }
    }

    #[test]
    fn notes_render_scoped_and_budgeted() {
        let notes = vec![
            n(
                "orders",
                None,
                Some("revenue"),
                "SUM(total) WHERE status <> 3",
            ),
            n("orders", Some("status"), None, "3 = cancelled"),
            n("orders", None, None, "One row per order"),
            n("secrets", None, None, "do not leak"),
        ];
        let all = Scope::new(None, Driver::Postgres);
        let s = render_notes(&notes, &all, 10_000);
        let order = |needle: &str| s.find(needle).unwrap_or_else(|| panic!("{needle} in {s}"));
        assert!(order("public.orders: One row per order") < order("status: 3 = cancelled"));
        assert!(order("status: 3 = cancelled") < order("metric revenue = SUM(total)"));
        assert!(s.contains("public.secrets"));

        let only_orders = [ScopeEntry {
            schema: "public".into(),
            table: Some("orders".into()),
        }];
        let scoped = Scope::new(Some(&only_orders), Driver::Postgres);
        let s = render_notes(&notes, &scoped, 10_000);
        assert!(s.contains("orders") && !s.contains("secrets") && !s.contains("leak"));

        let tiny = render_notes(&notes, &all, 60);
        assert!(tiny.contains("truncated"), "{tiny}");
        assert!(!tiny.contains("leak"));
        assert_eq!(render_notes(&[], &all, 100), "");
    }
}
