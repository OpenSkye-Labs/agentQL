pub mod mongo;
pub mod redis;
pub mod sql;
pub mod value;

use crate::config::{ConnectionConfig, ConnectionSecrets, Driver};
use crate::error::{AppError, Result};
use crate::ssh::Tunnel;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Column {
    pub name: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected: Option<u64>,
    pub duration_ms: u128,
    pub truncated: bool,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    /// table | view | matview | foreign | collection
    pub kind: String,
    pub row_estimate: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_primary: bool,
    pub position: i32,
    pub comment: Option<String>,
    pub extra: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub definition: Option<String>,
    /// Access method from the catalog (`btree`, `hnsw`, `gin` …); Postgres only.
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub ref_schema: Option<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
}

/// One column of a schema-wide catalog (editor completion).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogColumn {
    pub table: String,
    pub name: String,
    pub data_type: String,
}

/// One foreign key of a schema-wide catalog (editor JOIN suggestions).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogForeignKey {
    pub table: String,
    pub columns: Vec<String>,
    pub ref_schema: Option<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
}

/// Every column and foreign key of one schema, fetched in a couple of round trips for completion.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SchemaCatalog {
    pub columns: Vec<CatalogColumn>,
    pub foreign_keys: Vec<CatalogForeignKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TableDetails {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub ddl: Option<String>,
}

/// One table or view with everything we introspect about it (ER diagram, schema diff).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaObject {
    pub table: TableInfo,
    pub details: TableDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TableQuery {
    pub schema: Option<String>,
    pub table: String,
    /// raw WHERE clause body (no WHERE keyword)
    pub filter: Option<String>,
    pub order_by: Option<String>,
    pub order_desc: bool,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum RowChange {
    Update {
        key: HashMap<String, serde_json::Value>,
        values: HashMap<String, serde_json::Value>,
    },
    Insert {
        values: HashMap<String, serde_json::Value>,
    },
    Delete {
        key: HashMap<String, serde_json::Value>,
    },
}

pub enum Live {
    Sql(sql::SqlConn),
    Redis(redis::RedisConn),
    Mongo(mongo::MongoConn),
}

pub struct Session {
    pub config: ConnectionConfig,
    pub live: Live,
    pub _tunnel: Option<Tunnel>,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Default)]
pub struct Manager {
    sessions: RwLock<HashMap<String, Arc<Session>>>,
    pub known_hosts_path: std::path::PathBuf,
}

impl Manager {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Manager {
            sessions: Default::default(),
            known_hosts_path: data_dir.join("ssh_known_hosts.json"),
        }
    }

    pub async fn connect(
        &self,
        mut config: ConnectionConfig,
        secrets: &ConnectionSecrets,
    ) -> Result<Arc<Session>> {
        // Optional SSH tunnel: rewrite host/port to the local forward.
        let mut tunnel = None;
        if let Some(ssh) = config.ssh.clone() {
            let (rhost, rport) = target_host_port(&config)?;
            let t = Tunnel::open(
                &ssh,
                secrets.ssh_password.as_deref(),
                secrets.ssh_key_passphrase.as_deref(),
                &rhost,
                rport,
                self.known_hosts_path.clone(),
            )
            .await?;
            config.host = "127.0.0.1".into();
            config.port = t.local_port;
            if let Some(url) = &config.url {
                config.url = Some(rewrite_url_host(url, "127.0.0.1", t.local_port));
            }
            tunnel = Some(t);
        }

        let live = match config.driver {
            Driver::Postgres | Driver::Mysql | Driver::Mariadb | Driver::Sqlite => {
                Live::Sql(sql::SqlConn::connect(&config, secrets).await?)
            }
            Driver::Redis => Live::Redis(redis::RedisConn::connect(&config, secrets).await?),
            Driver::Mongodb => {
                Live::Mongo(mongo::MongoConn::connect(&config, secrets, tunnel.is_some()).await?)
            }
        };
        let session = Arc::new(Session {
            config: config.clone(),
            live,
            _tunnel: tunnel,
            connected_at: chrono::Utc::now(),
        });
        self.sessions
            .write()
            .await
            .insert(config.id.clone(), session.clone());
        Ok(session)
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(s) = self.sessions.write().await.remove(id)
            && let Live::Sql(c) = &s.live
        {
            c.close().await;
        }
    }

    pub async fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotConnected(id.to_string()))
    }

    pub async fn connected_ids(&self) -> Vec<String> {
        self.sessions.read().await.keys().cloned().collect()
    }
}

fn target_host_port(c: &ConnectionConfig) -> Result<(String, u16)> {
    if let Some(url) = &c.url {
        let parsed =
            url::Url::parse(url).map_err(|e| AppError::Msg(format!("invalid url: {e}")))?;
        let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
        let port = parsed.port().unwrap_or(c.driver.default_port());
        return Ok((host, port));
    }
    let port = if c.port == 0 {
        c.driver.default_port()
    } else {
        c.port
    };
    Ok((c.host.clone(), port))
}

fn rewrite_url_host(url: &str, host: &str, port: u16) -> String {
    match url::Url::parse(url) {
        Ok(mut u) => {
            let _ = u.set_host(Some(host));
            let _ = u.set_port(Some(port));
            u.to_string()
        }
        Err(_) => url.to_string(),
    }
}
