//! Tauri command surface. Thin wrappers that delegate to the modules.

mod app;
mod nosql;
mod sql;
pub use app::*;
pub use nosql::*;
pub use sql::*;

use crate::AppState;
use crate::ai::{self, AgentEvent, ChatSession, Ctx};
use crate::config::{ConnectionConfig, ConnectionSecrets, Note, Settings};
use crate::db::mongo::MongoFind;
use crate::db::redis::ScanResult;
use crate::db::{
    Live, QueryResult, RowChange, SchemaCatalog, SchemaObject, TableDetails, TableInfo, TableQuery,
};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

fn ctx(app: &AppHandle, st: &AppState) -> Ctx {
    Ctx {
        app: app.clone(),
        manager: st.manager.clone(),
        store: st.store.clone(),
        agent: st.agent.clone(),
    }
}

async fn sql(s: &crate::db::Session) -> Result<&crate::db::sql::SqlConn> {
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

pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?
}

// ----------------------------------------------------------------- connections

#[tauri::command]
pub fn list_connections(st: State<'_, AppState>) -> Vec<ConnectionConfig> {
    st.store.connections()
}

#[tauri::command]
pub fn save_connection(
    st: State<'_, AppState>,
    mut config: ConnectionConfig,
    secrets: Option<ConnectionSecrets>,
) -> Result<ConnectionConfig> {
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
    // Never persist a password inside the URL; move it to the secret store.
    let mut secrets = secrets;
    if let Some(url) = config.url.clone() {
        let (clean, pw) = crate::config::strip_url_password(&url);
        if let Some(pw) = pw {
            config.url = Some(clean);
            let mut s = secrets.unwrap_or_default();
            if s.password.as_deref().unwrap_or("").is_empty() {
                s.password = Some(pw);
            }
            secrets = Some(s);
        }
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
    let list: Vec<_> = st
        .store
        .connections()
        .into_iter()
        .filter(|c| c.id != id)
        .collect();
    st.store.save_connections(&list)?;
    // Secrets first: an unreadable notes.json must not leave a deleted connection's password behind.
    let store = st.store.clone();
    blocking(move || {
        store.delete_connection_secrets(&id)?;
        store.delete_notes(&id)
    })
    .await
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
pub async fn test_connection(
    st: State<'_, AppState>,
    config: ConnectionConfig,
    secrets: Option<ConnectionSecrets>,
) -> Result<String> {
    let m = crate::db::Manager::new(st.store.dir());
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
            c.run_one(q, 1).await.ok().and_then(|r| {
                r.rows
                    .first()
                    .and_then(|row| row.first())
                    .and_then(|v| v.as_str().map(str::to_string))
            })
        }
        Live::Redis(r) => r
            .info()
            .await
            .ok()
            .and_then(|i| i["redis_version"].as_str().map(|v| format!("Redis {v}"))),
        Live::Mongo(m) => m
            .run_command("admin", &json!({"buildInfo": 1}))
            .await
            .ok()
            .and_then(|v| v["version"].as_str().map(|v| format!("MongoDB {v}"))),
    }
}

#[tauri::command]
pub async fn connect(
    st: State<'_, AppState>,
    id: String,
    database: Option<String>,
) -> Result<ConnectResult> {
    let mut cfg = st
        .store
        .connections()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::Msg("connection not found".into()))?;
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        cfg.database = db.clone();
        if let Some(url) = &cfg.url
            && let Ok(mut u) = url::Url::parse(url)
        {
            u.set_path(&format!("/{db}"));
            cfg.url = Some(u.to_string());
        }
    }
    let secrets = st.store.connection_secrets(&id);
    st.manager.disconnect(&id).await;
    let s = st.manager.connect(cfg, &secrets).await?;
    Ok(ConnectResult {
        id: s.config.id.clone(),
        driver: s.config.driver,
        database: s.config.database.clone(),
        server_version: server_version(&s).await,
    })
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
