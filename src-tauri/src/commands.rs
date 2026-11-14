//! Tauri command surface. Thin wrappers that delegate to the modules.

mod app;
mod nosql;
mod sql;
pub use app::*;
pub use nosql::*;
pub use sql::*;

use crate::AppState;
use crate::ai::{self, AgentEvent, ChatSession, Ctx};
use crate::config::{ConnectionConfig, ConnectionSecrets, Note, Settings, Store};
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

/// Reads, edits and rewrites `connections.json` under one lock. Every writer goes through here: the commands run
/// concurrently, and two unlocked read-modify-writes drop each other's change (and share the `.tmp` file).
/// A file that exists and does not parse is an error, never replaced by the edited empty list.
pub fn update_connections<T>(
    store: &Store,
    f: impl FnOnce(&mut Vec<ConnectionConfig>) -> Result<T>,
) -> Result<T> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // shortcut: repeats Store::read_strict, which is private to config.rs (over the 20 KB commit limit); move this
    // helper onto Store when config.rs is split.
    let mut list: Vec<ConnectionConfig> = match std::fs::read(store.dir().join("connections.json")) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| {
            AppError::Msg(format!(
                "connections.json is not valid JSON ({e}); fix or remove it before connections can be saved"
            ))
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    let out = f(&mut list)?;
    store.save_connections(&list)?;
    Ok(out)
}

#[tauri::command]
pub async fn save_connection(
    st: State<'_, AppState>,
    config: ConnectionConfig,
    secrets: Option<ConnectionSecrets>,
) -> Result<ConnectionConfig> {
    let store = st.store.clone();
    blocking(move || store_connection(&store, config, secrets)).await
}

/// `save_connection` without Tauri state: the list under the lock, then the secrets.
pub fn store_connection(
    store: &Store,
    mut config: ConnectionConfig,
    secrets: Option<ConnectionSecrets>,
) -> Result<ConnectionConfig> {
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
    update_connections(store, |list| {
        match list.iter_mut().find(|c| c.id == config.id) {
            Some(existing) => *existing = config.clone(),
            None => list.push(config.clone()),
        }
        Ok(())
    })?;
    if let Some(s) = secrets {
        store.save_connection_secrets(&config.id, &s)?;
    }
    Ok(config)
}

#[tauri::command]
pub async fn delete_connection(st: State<'_, AppState>, id: String) -> Result<()> {
    st.manager.disconnect(&id).await;
    // Secrets first: an unreadable notes.json must not leave a deleted connection's password behind.
    let store = st.store.clone();
    blocking(move || {
        remove_connection(&store, &id)?;
        store.delete_connection_secrets(&id)?;
        store.delete_notes(&id)
    })
    .await
}

/// The list half of `delete_connection`; secrets and notes are the command's.
pub fn remove_connection(store: &Store, id: &str) -> Result<()> {
    update_connections(store, |list| {
        list.retain(|c| c.id != id);
        Ok(())
    })
}

// Keychain calls can block for seconds (a D-Bus timeout, an unlock prompt) and sync commands run on the main
// thread, so every command that touches the keychain is async and does its work in `blocking`.

#[tauri::command]
pub async fn get_connection_secrets(
    st: State<'_, AppState>,
    id: String,
) -> Result<ConnectionSecrets> {
    let store = st.store.clone();
    blocking(move || Ok(store.connection_secrets(&id))).await
}

#[tauri::command]
pub async fn secret_storage(st: State<'_, AppState>) -> Result<&'static str> {
    let store = st.store.clone();
    blocking(move || Ok(store.secret_storage())).await
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
