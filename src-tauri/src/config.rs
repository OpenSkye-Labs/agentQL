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

const KEYRING_SERVICE: &str = "com.aindong.agentql";

/// The keyring backend blocks on its own async runtime, which panics when called from a tokio
/// worker (every async Tauri command). Run keychain calls on a plain thread instead.
fn off_runtime<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|s| {
        s.spawn(f)
            .join()
            .unwrap_or_else(|_| std::panic::resume_unwind(Box::new("keyring thread panicked")))
    })
}

fn keyring_get(key: &str) -> Option<String> {
    off_runtime(|| {
        keyring::Entry::new(KEYRING_SERVICE, key)
            .ok()
            .and_then(|e| e.get_password().ok())
    })
}

fn keyring_set(key: &str, value: Option<&str>) -> bool {
    off_runtime(|| match keyring::Entry::new(KEYRING_SERVICE, key) {
        Ok(entry) => match value {
            Some(v) => entry.set_password(v).is_ok(),
            None => matches!(
                entry.delete_credential(),
                Ok(()) | Err(keyring::Error::NoEntry)
            ),
        },
        Err(_) => false,
    })
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

    // -- secrets --

    pub fn get_secret(&self, key: &str) -> Option<String> {
        // The fallback file only ever holds values the keychain refused, so it is the freshest source.
        if let Some(v) = self.secrets_fallback.lock().unwrap().get(key).cloned() {
            return Some(v);
        }
        keyring_get(key)
    }

    pub fn set_secret(&self, key: &str, value: Option<&str>) -> Result<()> {
        let keyring_ok = keyring_set(key, value);
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
        write_secret_json(&self.path("secrets.local.json"), &*fb)
    }

    pub fn secret_storage(&self) -> &'static str {
        off_runtime(|| match keyring::Entry::new(KEYRING_SERVICE, "__probe__") {
            Ok(e) if e.set_password("1").is_ok() => {
                let _ = e.delete_credential();
                "keychain"
            }
            _ => "file",
        })
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
        self.set_secret(
            &format!("{id}:ssh_key_passphrase"),
            s.ssh_key_passphrase.as_deref(),
        )?;
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
    std::fs::rename(&tmp, path)
        .map_err(|e| AppError::Msg(format!("saving {}: {e}", path.display())))
}

/// Like `write_json` but owner-only permissions on Unix (0600 file, 0700 dir).
fn write_secret_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(value)?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        if let Some(dir) = path.parent() {
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&data)?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)
        .map_err(|e| AppError::Msg(format!("saving {}: {e}", path.display())))
}

/// Split `scheme://user:pass@host/...` into a URL without the password and the password itself.
pub fn strip_url_password(url: &str) -> (String, Option<String>) {
    let Some(scheme_end) = url.find("://") else {
        return (url.to_string(), None);
    };
    let rest = &url[scheme_end + 3..];
    let auth_end = rest
        .find('/')
        .or_else(|| rest.find('?'))
        .unwrap_or(rest.len());
    let authority = &rest[..auth_end];
    let Some(at) = authority.rfind('@') else {
        return (url.to_string(), None);
    };
    let userinfo = &authority[..at];
    let Some(colon) = userinfo.find(':') else {
        return (url.to_string(), None);
    };
    let password = &userinfo[colon + 1..];
    let decoded = pct_decode(password);
    let sanitized = format!(
        "{}{}{}",
        &url[..scheme_end + 3],
        &userinfo[..colon],
        &rest[at..]
    );
    (sanitized, Some(decoded))
}

/// Inject a password into a URL whose userinfo lacks one.
pub fn url_with_password(url: &str, user: &str, password: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    let rest = &url[scheme_end + 3..];
    let auth_end = rest
        .find('/')
        .or_else(|| rest.find('?'))
        .unwrap_or(rest.len());
    let authority = &rest[..auth_end];
    let enc = pct_encode;
    match authority.rfind('@') {
        Some(at) => {
            let userinfo = &authority[..at];
            if userinfo.contains(':') {
                return url.to_string();
            }
            format!(
                "{}{}:{}{}",
                &url[..scheme_end + 3],
                userinfo,
                enc(password),
                &rest[at..]
            )
        }
        None if !user.is_empty() => format!(
            "{}{}:{}@{}",
            &url[..scheme_end + 3],
            enc(user),
            enc(password),
            rest
        ),
        None => url.to_string(),
    }
}

pub fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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

#[cfg(test)]
mod keyring_tests {
    #[test]
    #[ignore]
    fn keyring_latency() {
        let t = std::time::Instant::now();
        let v = super::keyring_get("__does_not_exist__");
        println!("keyring_get(none) -> {v:?} in {:?}", t.elapsed());
        let t = std::time::Instant::now();
        println!(
            "secret_storage probe -> {} in {:?}",
            super::Store::new(std::env::temp_dir().join("agentql-kr-test")).secret_storage(),
            t.elapsed()
        );
    }
}
