//! Secrets: the OS keychain, and the plaintext `secrets.local.json` fallback.

use super::{ConnectionSecrets, Store};
use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::Path;
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
