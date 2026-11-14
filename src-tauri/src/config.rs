//! Connection definitions, app settings and their on-disk storage.
//! Everything non-secret lives in JSON files under the app data dir;
//! passwords go to the OS keychain with a plaintext-file fallback.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

mod secrets;
pub use secrets::{pct_decode, pct_encode, strip_url_password, url_with_password};

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
        matches!(
            self,
            Driver::Postgres | Driver::Mysql | Driver::Mariadb | Driver::Sqlite
        )
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Staging,
    Production,
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
    /// `production` makes the UI confirm every SQL write.
    #[serde(default)]
    pub environment: Option<Environment>,
    #[serde(default)]
    pub options: HashMap<String, String>,
    /// Schemas/tables the AI agent may see. `None` = everything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_scope: Option<Vec<ScopeEntry>>,
    /// When the user allowed sending this connection's schema and data to a remote LLM provider.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_remote_consent_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// One allowed item of the agent scope: a whole schema (`table: None`) or a single table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeEntry {
    pub schema: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
}

/// One data-dictionary entry the agent reads, stored in `notes.json`, never in the database.
/// `column` set = column note, `metric` set = named metric (`text` is its definition), neither = table note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub schema: String,
    pub table: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    pub text: String,
}

pub const NOTE_MAX_CHARS: usize = 2000;
const METRIC_NAME_MAX_CHARS: usize = 64;

impl Note {
    /// Collapse the text to one line and refuse shapes the prompt cannot render safely.
    pub fn normalized(mut self) -> Result<Note> {
        if self.column.is_some() && self.metric.is_some() {
            return Err(AppError::Msg(
                "a note is for a column or a metric, not both".into(),
            ));
        }
        if let Some(m) = &self.metric {
            let m = m.trim();
            if m.is_empty()
                || m.chars().count() > METRIC_NAME_MAX_CHARS
                || m.chars()
                    .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}')
            {
                return Err(AppError::Msg(format!(
                    "a metric name is one line of at most {METRIC_NAME_MAX_CHARS} characters"
                )));
            }
            self.metric = Some(m.to_string());
        }
        self.text = self.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if self.text.chars().count() > NOTE_MAX_CHARS {
            return Err(AppError::Msg(format!(
                "a note is at most {NOTE_MAX_CHARS} characters"
            )));
        }
        Ok(self)
    }

    pub fn same_target(&self, o: &Note) -> bool {
        self.schema == o.schema
            && self.table == o.table
            && self.column == o.column
            && self.metric == o.metric
    }
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
    /// Vim keybindings in the SQL editor.
    #[serde(default)]
    pub editor_vim: bool,
}
fn default_row_limit() -> u32 {
    1000
}

// ---------- storage ----------

pub struct Store {
    dir: PathBuf,
    secrets_fallback: Mutex<HashMap<String, String>>,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("chats")).ok();
        let fallback = read_json::<HashMap<String, String>>(&dir.join("secrets.local.json"))
            .unwrap_or_default();
        Store {
            dir,
            secrets_fallback: Mutex::new(fallback),
        }
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

    /// Prepend one entry to the query history (`history.json`, newest first, capped at 500).
    /// The UI and the agent both append through here so neither overwrites the other.
    pub fn push_history(&self, entry: serde_json::Value) -> Result<()> {
        static LOCK: Mutex<()> = Mutex::new(());
        let _g = LOCK.lock().unwrap();
        let mut list: Vec<serde_json::Value> = self.read_strict("history.json")?;
        list.insert(0, entry);
        list.truncate(500);
        self.write("history.json", &list)
    }

    /// Like `read`, but a file that exists and does not parse is an error instead of the default,
    /// so a read-modify-write can never replace the user's data with a fresh value.
    fn read_strict<T: for<'de> Deserialize<'de> + Default>(&self, name: &str) -> Result<T> {
        match std::fs::read(self.path(name)) {
            Ok(data) => serde_json::from_slice(&data).map_err(|e| {
                AppError::Msg(format!(
                    "{name} is not valid JSON ({e}); fix or remove it before it can be read or saved"
                ))
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// `notes.json`: connection id -> notes.
    fn notes_file(&self) -> Result<HashMap<String, Vec<Note>>> {
        self.read_strict("notes.json")
    }

    fn notes_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn notes(&self, connection_id: &str) -> Result<Vec<Note>> {
        Ok(self.notes_file()?.remove(connection_id).unwrap_or_default())
    }

    /// Insert or replace the note for the same target; blank text deletes it. Text is stored as one line
    /// (what the prompt and the approval card show), so whitespace cannot hide part of a note.
    pub fn save_note(&self, connection_id: &str, mut note: Note) -> Result<()> {
        note = Note::normalized(note)?;
        let _g = Self::notes_lock();
        // Checked under the lock: a save racing a connection delete either lands before delete_notes clears it or
        // is refused here, never orphaned.
        if !self.connections().iter().any(|c| c.id == connection_id) {
            return Err(AppError::Msg("connection no longer exists".into()));
        }
        let mut all = self.notes_file()?;
        let list = all.entry(connection_id.to_string()).or_default();
        list.retain(|n| !n.same_target(&note));
        if !note.text.is_empty() {
            list.push(note);
        }
        if list.is_empty() {
            all.remove(connection_id);
        }
        self.write("notes.json", &all)
    }

    pub fn delete_notes(&self, connection_id: &str) -> Result<()> {
        let _g = Self::notes_lock();
        let mut all = self.notes_file()?;
        if all.remove(connection_id).is_some() {
            self.write("notes.json", &all)?;
        }
        Ok(())
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.write("settings.json", s)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)
        .map_err(|e| AppError::Msg(format!("saving {}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_password_roundtrip() {
        let (u, p) =
            strip_url_password("postgres://bob:s%3Acret@db.example.com:5432/app?sslmode=require");
        assert_eq!(u, "postgres://bob@db.example.com:5432/app?sslmode=require");
        assert_eq!(p.as_deref(), Some("s:cret"));
        assert_eq!(
            url_with_password(&u, "bob", "s:cret"),
            "postgres://bob:s%3Acret@db.example.com:5432/app?sslmode=require"
        );
        assert_eq!(strip_url_password("redis://localhost:6379/0").1, None);
        assert_eq!(
            url_with_password("mongodb+srv://cluster.x.net/db", "u", "p w"),
            "mongodb+srv://u:p%20w@cluster.x.net/db"
        );
        assert_eq!(pct_decode("a%2Fb%"), "a/b%");
    }

    fn note(column: Option<&str>, metric: Option<&str>, text: &str) -> Note {
        Note {
            schema: "public".into(),
            table: "orders".into(),
            column: column.map(Into::into),
            metric: metric.map(Into::into),
            text: text.into(),
        }
    }

    /// A store with connections "a" and "b" (notes are refused for unknown connections).
    fn temp_store(name: &str) -> Store {
        let dir = std::env::temp_dir().join(format!("agentql-notes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let st = Store::new(dir);
        let conn = |id: &str| -> ConnectionConfig {
            serde_json::from_value(serde_json::json!({"id": id, "name": id, "driver": "postgres"}))
                .unwrap()
        };
        st.save_connections(&[conn("a"), conn("b")]).unwrap();
        st
    }

    #[test]
    fn notes_upsert_delete_and_isolation() {
        let st = temp_store("upsert");
        st.save_note("a", note(None, None, "One row per order"))
            .unwrap();
        st.save_note("a", note(Some("status"), None, "3 = cancelled"))
            .unwrap();
        st.save_note("a", note(None, Some("revenue"), "SUM(total)"))
            .unwrap();
        st.save_note("b", note(None, None, "other connection"))
            .unwrap();
        // Same target replaces, it does not duplicate.
        st.save_note(
            "a",
            note(Some("status"), None, "3 = cancelled, 4 = refunded"),
        )
        .unwrap();
        let a = st.notes("a").unwrap();
        assert_eq!(a.len(), 3);
        assert!(a.iter().any(|n| n.text == "3 = cancelled, 4 = refunded"));
        // Empty text deletes.
        st.save_note("a", note(None, Some("revenue"), "  "))
            .unwrap();
        assert_eq!(st.notes("a").unwrap().len(), 2);
        assert_eq!(st.notes("b").unwrap().len(), 1);
        st.delete_notes("a").unwrap();
        assert!(st.notes("a").unwrap().is_empty());
        assert_eq!(st.notes("b").unwrap().len(), 1);
        assert!(
            st.save_note("a", note(Some("c"), Some("m"), "both"))
                .is_err()
        );
    }

    #[test]
    fn notes_are_one_line_and_bounded() {
        let st = temp_store("bounded");
        st.save_note("a", note(None, None, "  first\n\n\n\t  hidden  "))
            .unwrap();
        assert_eq!(st.notes("a").unwrap()[0].text, "first hidden");
        assert!(
            st.save_note("a", note(None, Some("rev\nIGNORE"), "x"))
                .is_err()
        );
        for sep in ["rev\u{2028}x", "rev\u{2029}x"] {
            assert!(st.save_note("a", note(None, Some(sep), "x")).is_err());
        }
        // A deleted (unknown) connection cannot get notes back.
        assert!(st.save_note("deleted", note(None, None, "x")).is_err());
        assert!(
            st.save_note("a", note(None, Some(&"m".repeat(65)), "x"))
                .is_err()
        );
        assert!(
            st.save_note("a", note(None, None, &"x".repeat(NOTE_MAX_CHARS + 1)))
                .is_err()
        );
        st.save_note("a", note(None, Some(" revenue "), "x"))
            .unwrap();
        assert!(
            st.notes("a")
                .unwrap()
                .iter()
                .any(|n| n.metric.as_deref() == Some("revenue"))
        );
    }

    /// The UI sends `column: null` / `metric: null` for a table note; that must read as `None`.
    #[test]
    fn note_accepts_the_ui_wire_format() {
        let n: Note = serde_json::from_str(
            r#"{"schema":"public","table":"orders","column":null,"metric":null,"text":"x"}"#,
        )
        .unwrap();
        assert_eq!(n, note(None, None, "x"));
    }

    #[test]
    fn notes_corrupt_file_is_never_overwritten() {
        let st = temp_store("corrupt");
        std::fs::write(st.dir().join("notes.json"), b"{ not json").unwrap();
        assert!(st.notes("a").is_err());
        assert!(st.save_note("a", note(None, None, "x")).is_err());
        assert_eq!(
            std::fs::read(st.dir().join("notes.json")).unwrap(),
            b"{ not json"
        );
    }
}
