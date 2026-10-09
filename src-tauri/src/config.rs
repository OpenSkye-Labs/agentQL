//! Connection definitions, app settings and their on-disk storage.
//! Everything non-secret lives in JSON files under the app data dir;
//! passwords go to the OS keychain with a plaintext-file fallback.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Driver {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
    Redis,
    Mongodb,
}

impl Driver {
    pub fn is_sql(self) -> bool {
        matches!(self, Driver::Postgres | Driver::Mysql | Driver::Mariadb | Driver::Sqlite)
    }
    pub fn default_port(self) -> u16 {
        match self {
            Driver::Postgres => 5432,
            Driver::Mysql | Driver::Mariadb => 3306,
            Driver::Sqlite => 0,
            Driver::Redis => 6379,
            Driver::Mongodb => 27017,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Driver::Postgres => "PostgreSQL",
            Driver::Mysql => "MySQL",
            Driver::Mariadb => "MariaDB",
            Driver::Sqlite => "SQLite",
            Driver::Redis => "Redis",
            Driver::Mongodb => "MongoDB",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SshAuth {
    #[default]
    Agent,
    Password,
    KeyFile {
        path: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub auth: SshAuth,
}
fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub driver: Driver,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    /// Connect using a full URL instead of discrete fields. Password may be
    /// embedded or kept in the secret store and injected at connect time.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub database: String,
    /// sqlite file path
    #[serde(default)]
    pub file_path: Option<String>,
    /// disable | prefer | require | verify-ca | verify-full
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub ssl_ca_path: Option<String>,
    #[serde(default)]
    pub ssl_cert_path: Option<String>,
    #[serde(default)]
    pub ssl_key_path: Option<String>,
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub options: HashMap<String, String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Secrets travel with the config only in memory / over IPC, never to connections.json.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionSecrets {
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    /// anthropic | openai | openai_compatible | claude_cli | codex_cli
    pub kind: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: String,
    /// path override for CLI providers
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub providers: Vec<LlmProvider>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default = "default_row_limit")]
    pub row_limit: u32,
    /// Let the agent run write statements after an in-app approval.
    #[serde(default)]
    pub agent_allow_writes: bool,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub editor_font_size: Option<u8>,
}
fn default_row_limit() -> u32 {
    1000
}

// ---------- storage ----------

pub struct Store {
    dir: PathBuf,
    secrets_fallback: Mutex<HashMap<String, String>>,
}

const KEYRING_SERVICE: &str = "com.aindong.agentql";

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("chats")).ok();
        let fallback = read_json::<HashMap<String, String>>(&dir.join("secrets.local.json")).unwrap_or_default();
        Store { dir, secrets_fallback: Mutex::new(fallback) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn read<T: for<'de> Deserialize<'de> + Default>(&self, name: &str) -> T {
        read_json(&self.path(name)).unwrap_or_default()
    }

    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<()> {
        write_json(&self.path(name), value)
    }

    pub fn connections(&self) -> Vec<ConnectionConfig> {
        self.read("connections.json")
    }

    pub fn save_connections(&self, list: &[ConnectionConfig]) -> Result<()> {
        self.write("connections.json", &list)
    }

    pub fn settings(&self) -> Settings {
        self.read("settings.json")
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.write("settings.json", s)
    }

    // -- secrets --

    pub fn get_secret(&self, key: &str) -> Option<String> {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, key) {
            if let Ok(v) = entry.get_password() {
                return Some(v);
            }
        }
        self.secrets_fallback.lock().unwrap().get(key).cloned()
    }

    pub fn set_secret(&self, key: &str, value: Option<&str>) -> Result<()> {
        let keyring_ok = match keyring::Entry::new(KEYRING_SERVICE, key) {
            Ok(entry) => match value {
                Some(v) => entry.set_password(v).is_ok(),
                None => {
                    let _ = entry.delete_credential();
                    true
                }
            },
            Err(_) => false,
        };
        // ponytail: plaintext local fallback when no OS keychain is reachable (e.g. WSL / headless);
        // the UI surfaces `secret_storage` so the user knows.
        let mut fb = self.secrets_fallback.lock().unwrap();
        if keyring_ok {
            fb.remove(key);
        } else if let Some(v) = value {
            fb.insert(key.to_string(), v.to_string());
        } else {
            fb.remove(key);
        }
        write_json(&self.path("secrets.local.json"), &*fb)
    }

    pub fn secret_storage(&self) -> &'static str {
        match keyring::Entry::new(KEYRING_SERVICE, "__probe__") {
            Ok(e) if e.set_password("1").is_ok() => {
                let _ = e.delete_credential();
                "keychain"
            }
            _ => "file",
        }
    }

    pub fn connection_secrets(&self, id: &str) -> ConnectionSecrets {
        ConnectionSecrets {
            password: self.get_secret(&format!("{id}:password")),
            ssh_password: self.get_secret(&format!("{id}:ssh_password")),
            ssh_key_passphrase: self.get_secret(&format!("{id}:ssh_key_passphrase")),
        }
    }

    pub fn save_connection_secrets(&self, id: &str, s: &ConnectionSecrets) -> Result<()> {
        self.set_secret(&format!("{id}:password"), s.password.as_deref())?;
        self.set_secret(&format!("{id}:ssh_password"), s.ssh_password.as_deref())?;
        self.set_secret(&format!("{id}:ssh_key_passphrase"), s.ssh_key_passphrase.as_deref())?;
        Ok(())
    }

    pub fn delete_connection_secrets(&self, id: &str) -> Result<()> {
        self.save_connection_secrets(id, &ConnectionSecrets::default())
    }

    pub fn provider_api_key(&self, provider_id: &str) -> Option<String> {
        self.get_secret(&format!("llm:{provider_id}"))
    }

    pub fn set_provider_api_key(&self, provider_id: &str, key: Option<&str>) -> Result<()> {
        self.set_secret(&format!("llm:{provider_id}"), key)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path).map_err(|e| AppError::Msg(format!("saving {}: {e}", path.display())))
}
