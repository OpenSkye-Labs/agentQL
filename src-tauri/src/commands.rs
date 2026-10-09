//! Tauri command surface. Thin wrappers that delegate to the modules.

use crate::ai::{self, AgentEvent, ChatSession, Ctx};
use crate::config::{ConnectionConfig, ConnectionSecrets, Settings};
use crate::db::mongo::MongoFind;
use crate::db::redis::ScanResult;
use crate::db::{Live, QueryResult, RowChange, TableDetails, TableInfo, TableQuery};
use crate::error::{AppError, Result};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

fn ctx(app: &AppHandle, st: &AppState) -> Ctx {
    Ctx { app: app.clone(), manager: st.manager.clone(), store: st.store.clone(), agent: st.agent.clone() }
}

async fn sql<'a>(s: &'a crate::db::Session) -> Result<&'a crate::db::sql::SqlConn> {
    match &s.live {
        Live::Sql(c) => Ok(c),
        _ => Err(AppError::Msg("not a SQL connection".into())),
    }
}
fn redis(s: &crate::db::Session) -> Result<&crate::db::redis::RedisConn> {
    match &s.live {
        Live::Redis(c) => Ok(c),
        _ => Err(AppError::Msg("not a Redis connection".into())),
    }
}
fn mongo(s: &crate::db::Session) -> Result<&crate::db::mongo::MongoConn> {
    match &s.live {
        Live::Mongo(c) => Ok(c),
        _ => Err(AppError::Msg("not a MongoDB connection".into())),
    }
}

// ----------------------------------------------------------------- connections

#[tauri::command]
pub fn list_connections(st: State<'_, AppState>) -> Vec<ConnectionConfig> {
    st.store.connections()
}

#[tauri::command]
pub fn save_connection(st: State<'_, AppState>, mut config: ConnectionConfig, secrets: Option<ConnectionSecrets>) -> Result<ConnectionConfig> {
    let mut list = st.store.connections();
    let now = chrono::Utc::now().to_rfc3339();
    if config.id.is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
        config.created_at = Some(now.clone());
    }
    config.updated_at = Some(now);
    if config.port == 0 {
        config.port = config.driver.default_port();
    }
    match list.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => *existing = config.clone(),
        None => list.push(config.clone()),
    }
    st.store.save_connections(&list)?;
    if let Some(s) = secrets {
        st.store.save_connection_secrets(&config.id, &s)?;
    }
    Ok(config)
}

#[tauri::command]
pub async fn delete_connection(st: State<'_, AppState>, id: String) -> Result<()> {
    st.manager.disconnect(&id).await;
    let list: Vec<_> = st.store.connections().into_iter().filter(|c| c.id != id).collect();
    st.store.save_connections(&list)?;
    st.store.delete_connection_secrets(&id)
}

#[tauri::command]
pub fn get_connection_secrets(st: State<'_, AppState>, id: String) -> ConnectionSecrets {
    st.store.connection_secrets(&id)
}

#[tauri::command]
pub fn secret_storage(st: State<'_, AppState>) -> &'static str {
    st.store.secret_storage()
}

#[derive(Serialize)]
pub struct ConnectResult {
    pub id: String,
    pub driver: crate::config::Driver,
    pub database: String,
    pub server_version: Option<String>,
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig, secrets: Option<ConnectionSecrets>) -> Result<String> {
    let m = crate::db::Manager::default();
    let mut cfg = config;
    cfg.id = format!("test-{}", uuid::Uuid::new_v4());
    let s = m.connect(cfg.clone(), &secrets.unwrap_or_default()).await?;
    let version = server_version(&s).await;
    m.disconnect(&cfg.id).await;
    Ok(version.unwrap_or_else(|| "connected".into()))
}

async fn server_version(s: &crate::db::Session) -> Option<String> {
    match &s.live {
        Live::Sql(c) => {
            let q = match c.driver {
                crate::config::Driver::Sqlite => "SELECT sqlite_version() AS v",
                crate::config::Driver::Postgres => "SHOW server_version",
                _ => "SELECT VERSION() AS v",
            };
            c.run_one(q, 1).await.ok().and_then(|r| r.rows.first().and_then(|row| row.first()).and_then(|v| v.as_str().map(str::to_string)))
        }
        Live::Redis(r) => r.info().await.ok().and_then(|i| i["redis_version"].as_str().map(|v| format!("Redis {v}"))),
        Live::Mongo(m) => m
            .run_command("admin", &json!({"buildInfo": 1}))
            .await
            .ok()
            .and_then(|v| v["version"].as_str().map(|v| format!("MongoDB {v}"))),
    }
}

#[tauri::command]
pub async fn connect(st: State<'_, AppState>, id: String, database: Option<String>) -> Result<ConnectResult> {
    let mut cfg = st
        .store
        .connections()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::Msg("connection not found".into()))?;
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        cfg.database = db.clone();
        if let Some(url) = &cfg.url {
            if let Ok(mut u) = url::Url::parse(url) {
                u.set_path(&format!("/{db}"));
                cfg.url = Some(u.to_string());
            }
        }
    }
    let secrets = st.store.connection_secrets(&id);
    st.manager.disconnect(&id).await;
    let s = st.manager.connect(cfg, &secrets).await?;
    Ok(ConnectResult { id: s.config.id.clone(), driver: s.config.driver, database: s.config.database.clone(), server_version: server_version(&s).await })
}

#[tauri::command]
pub async fn disconnect(st: State<'_, AppState>, id: String) -> Result<()> {
    st.manager.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn connected_connections(st: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(st.manager.connected_ids().await)
}

// ----------------------------------------------------------------- sql

#[tauri::command]
pub async fn run_query(st: State<'_, AppState>, id: String, sql_text: String, limit: Option<u32>) -> Result<Vec<QueryResult>> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    if s.config.read_only && !crate::db::sql::is_read_only(s.config.driver, &sql_text) {
        return Err(AppError::Msg("This connection is marked read-only. Disable it in the connection settings to run write statements.".into()));
    }
    let limit = limit.unwrap_or_else(|| st.store.settings().row_limit);
    c.run(&sql_text, limit).await
}

#[tauri::command]
pub async fn explain_query(st: State<'_, AppState>, id: String, sql_text: String, analyze: bool) -> Result<QueryResult> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    if analyze && !crate::db::sql::is_read_only(s.config.driver, &sql_text) {
        return Err(AppError::Msg("EXPLAIN ANALYZE executes the statement; refusing to analyze a write.".into()));
    }
    let stmt = crate::db::sql::split_statements(&sql_text).into_iter().next().unwrap_or_default();
    c.run_one(&c.explain_sql(&stmt, analyze), 10_000).await
}

#[tauri::command]
pub async fn list_databases(st: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    match &s.live {
        Live::Sql(c) => c.databases().await,
        Live::Mongo(m) => m.databases().await,
        Live::Redis(_) => Ok((0..16).map(|i| i.to_string()).collect()),
    }
}

#[tauri::command]
pub async fn list_schemas(st: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.schemas().await
}

#[tauri::command]
pub async fn list_tables(st: State<'_, AppState>, id: String, schema: String) -> Result<Vec<TableInfo>> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.tables(&schema).await
}

#[tauri::command]
pub async fn table_details(st: State<'_, AppState>, id: String, schema: String, table: String) -> Result<TableDetails> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.table_details(&schema, &table).await
}

#[derive(Serialize)]
pub struct TablePage {
    pub result: QueryResult,
    pub total: Option<i64>,
    pub sql_text: String,
}

#[tauri::command]
pub async fn fetch_table(st: State<'_, AppState>, id: String, query: TableQuery) -> Result<TablePage> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    let sql_text = c.select_sql(&query);
    let result = c.run_one(&sql_text, query.limit.max(1)).await?;
    let total = c.count(&query).await.ok();
    Ok(TablePage { result, total, sql_text })
}

#[tauri::command]
pub async fn preview_changes(st: State<'_, AppState>, id: String, schema: Option<String>, table: String, changes: Vec<RowChange>) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    Ok(sql(&s).await?.change_sql(schema.as_deref(), &table, &changes))
}

#[tauri::command]
pub async fn apply_changes(st: State<'_, AppState>, id: String, schema: Option<String>, table: String, changes: Vec<RowChange>) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    let c = sql(&s).await?;
    let stmts = c.change_sql(schema.as_deref(), &table, &changes);
    c.execute_batch(&stmts).await
}

#[tauri::command]
pub async fn export_rows(path: String, format: String, columns: Vec<String>, rows: Vec<Vec<Value>>) -> Result<usize> {
    let cell = |v: &Value| match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        o => o.to_string(),
    };
    match format.as_str() {
        "json" => {
            let objs: Vec<Value> = rows
                .iter()
                .map(|r| Value::Object(columns.iter().cloned().zip(r.iter().cloned()).collect()))
                .collect();
            std::fs::write(&path, serde_json::to_vec_pretty(&objs)?)?;
        }
        "sql" => {
            let table = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or("export".into());
            let mut out = String::new();
            for r in &rows {
                let vals: Vec<String> = r
                    .iter()
                    .map(|v| match v {
                        Value::Null => "NULL".into(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string().to_uppercase(),
                        o => format!("'{}'", cell(o).replace('\'', "''")),
                    })
                    .collect();
                out.push_str(&format!("INSERT INTO \"{table}\" ({}) VALUES ({});\n", columns.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "), vals.join(", ")));
            }
            std::fs::write(&path, out)?;
        }
        _ => {
            let mut w = csv::Writer::from_path(&path).map_err(|e| AppError::Msg(e.to_string()))?;
            w.write_record(&columns).map_err(|e| AppError::Msg(e.to_string()))?;
            for r in &rows {
                w.write_record(r.iter().map(cell)).map_err(|e| AppError::Msg(e.to_string()))?;
            }
            w.flush()?;
        }
    }
    Ok(rows.len())
}

// ----------------------------------------------------------------- redis

#[tauri::command]
pub async fn redis_scan(st: State<'_, AppState>, id: String, cursor: String, pattern: String, count: u32) -> Result<ScanResult> {
    let s = st.manager.get(&id).await?;
    redis(&s)?.scan(&cursor, &pattern, count.clamp(10, 1000)).await
}

#[tauri::command]
pub async fn redis_get(st: State<'_, AppState>, id: String, key: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    redis(&s)?.get_key(&key).await
}

#[tauri::command]
pub async fn redis_command(st: State<'_, AppState>, id: String, command: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only && !crate::db::redis::is_read_only_command(&command) {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    redis(&s)?.command(&command).await
}

#[tauri::command]
pub async fn redis_info(st: State<'_, AppState>, id: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    redis(&s)?.info().await
}

// ----------------------------------------------------------------- mongo

#[tauri::command]
pub async fn mongo_collections(st: State<'_, AppState>, id: String, db: String) -> Result<Vec<Value>> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.collections(&db).await
}

#[tauri::command]
pub async fn mongo_find(st: State<'_, AppState>, id: String, query: MongoFind) -> Result<crate::db::mongo::MongoPage> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.find(&query).await
}

#[tauri::command]
pub async fn mongo_aggregate(st: State<'_, AppState>, id: String, db: String, collection: String, pipeline: Value, limit: Option<usize>) -> Result<Vec<Value>> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.aggregate(&db, &collection, &pipeline, limit.unwrap_or(500)).await
}

#[tauri::command]
pub async fn mongo_insert(st: State<'_, AppState>, id: String, db: String, collection: String, document: Value) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?.insert(&db, &collection, &document).await
}

#[tauri::command]
pub async fn mongo_replace(st: State<'_, AppState>, id: String, db: String, collection: String, doc_id: Value, document: Value) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?.replace(&db, &collection, &doc_id, &document).await
}

#[tauri::command]
pub async fn mongo_delete(st: State<'_, AppState>, id: String, db: String, collection: String, doc_id: Value) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?.delete(&db, &collection, &doc_id).await
}

#[tauri::command]
pub async fn mongo_collection_info(st: State<'_, AppState>, id: String, db: String, collection: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.collection_info(&db, &collection).await
}

#[tauri::command]
pub async fn mongo_command(st: State<'_, AppState>, id: String, db: String, command: Value) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.run_command(&db, &command).await
}

// ----------------------------------------------------------------- settings / kv

#[tauri::command]
pub fn get_settings(st: State<'_, AppState>) -> Settings {
    st.store.settings()
}

#[tauri::command]
pub fn save_settings(st: State<'_, AppState>, settings: Settings) -> Result<()> {
    st.store.save_settings(&settings)
}

#[tauri::command]
pub fn set_provider_key(st: State<'_, AppState>, provider_id: String, key: Option<String>) -> Result<()> {
    st.store.set_provider_api_key(&provider_id, key.as_deref().filter(|k| !k.is_empty()))
}

#[tauri::command]
pub fn has_provider_key(st: State<'_, AppState>, provider_id: String) -> bool {
    st.store.provider_api_key(&provider_id).is_some_and(|k| !k.is_empty())
}

#[tauri::command]
pub fn detect_clis() -> Value {
    json!({ "claude": ai::providers::which("claude"), "codex": ai::providers::which("codex") })
}

/// Generic JSON document storage for UI-owned data (dashboards, saved queries, history).
#[tauri::command]
pub fn kv_get(st: State<'_, AppState>, name: String) -> Value {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Value::Null;
    }
    st.store.read::<Value>(&format!("{name}.json"))
}

#[tauri::command]
pub fn kv_set(st: State<'_, AppState>, name: String, value: Value) -> Result<()> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::Msg("invalid store name".into()));
    }
    st.store.write(&format!("{name}.json"), &value)
}

// ----------------------------------------------------------------- ai

#[tauri::command]
pub fn ai_list_sessions(app: AppHandle, st: State<'_, AppState>, connection_id: Option<String>) -> Vec<ChatSession> {
    ctx(&app, &st)
        .list_sessions()
        .into_iter()
        .filter(|s| connection_id.as_ref().is_none_or(|c| &s.connection_id == c))
        .map(|mut s| {
            s.messages.clear();
            s
        })
        .collect()
}

#[tauri::command]
pub fn ai_get_session(app: AppHandle, st: State<'_, AppState>, id: String) -> Result<ChatSession> {
    ctx(&app, &st).load_session(&id)
}

#[tauri::command]
pub fn ai_create_session(app: AppHandle, st: State<'_, AppState>, connection_id: String, provider_id: String) -> Result<ChatSession> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut s = ChatSession {
        id: uuid::Uuid::new_v4().to_string(),
        connection_id,
        provider_id,
        title: "New chat".into(),
        created_at: now.clone(),
        updated_at: now,
        ..Default::default()
    };
    ctx(&app, &st).save_session(&mut s)?;
    Ok(s)
}

#[tauri::command]
pub fn ai_delete_session(st: State<'_, AppState>, id: String) -> Result<()> {
    let path = st.store.dir().join("chats").join(format!("{id}.json"));
    std::fs::remove_file(path).ok();
    Ok(())
}

#[tauri::command]
pub fn ai_set_session_provider(app: AppHandle, st: State<'_, AppState>, id: String, provider_id: String) -> Result<()> {
    let c = ctx(&app, &st);
    let mut s = c.load_session(&id)?;
    if s.provider_id != provider_id {
        s.provider_id = provider_id;
        s.cli_session_id = None;
    }
    c.save_session(&mut s)
}

#[tauri::command]
pub async fn ai_send(app: AppHandle, st: State<'_, AppState>, session_id: String, text: String) -> Result<()> {
    let c = ctx(&app, &st);
    if c.agent.running.lock().unwrap().contains_key(&session_id) {
        return Err(AppError::Msg("the agent is still working on the previous message".into()));
    }
    let sid = session_id.clone();
    let handle = tokio::spawn(async move {
        let _ = ai::run_turn(c, sid, text).await;
    });
    st.agent.running.lock().unwrap().insert(session_id, handle.abort_handle());
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, st: State<'_, AppState>, session_id: String) -> Result<()> {
    if let Some(h) = st.agent.running.lock().unwrap().remove(&session_id) {
        h.abort();
    }
    let c = ctx(&app, &st);
    c.emit(&session_id, &AgentEvent::Error { message: "cancelled".into() });
    if let Ok(s) = c.load_session(&session_id) {
        c.emit(&session_id, &AgentEvent::Done { session: s });
    }
    Ok(())
}

#[tauri::command]
pub fn ai_resolve_approval(st: State<'_, AppState>, id: String, approved: bool) -> Result<()> {
    if let Some(tx) = st.agent.pending_approvals.lock().unwrap().remove(&id) {
        let _ = tx.send(approved);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ChartRequest {
    pub connection_id: String,
    pub source: Value,
}

#[tauri::command]
pub async fn run_chart(app: AppHandle, st: State<'_, AppState>, req: ChartRequest) -> Result<QueryResult> {
    let c = ctx(&app, &st);
    ai::tools::run_chart_source(&c, &req.connection_id, &req.source, false).await
}

#[tauri::command]
pub fn app_info(st: State<'_, AppState>) -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "data_dir": st.store.dir().to_string_lossy(),
        "mcp_port": st.agent.mcp_port.get(),
        "secret_storage": st.store.secret_storage(),
    })
}
