//! A working keychain (in-memory stand-in, so the test never touches the real one): secrets go to it,
//! and existing plaintext entries move into it and leave the file.
//!   cargo test --test secret_store_keychain

use agentql_lib::config::{Settings, Store};
use std::any::Any;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const GATED: &[u8] = b"old-gated";
static RELEASED: AtomicBool = AtomicBool::new(false);

type Mem = Arc<Mutex<HashMap<String, Vec<u8>>>>;

struct MemBuilder(Mem);
struct MemCred(Mem, String);

impl keyring::credential::CredentialBuilderApi for MemBuilder {
    fn build(
        &self,
        _: Option<&str>,
        service: &str,
        user: &str,
    ) -> keyring::Result<Box<keyring::credential::Credential>> {
        Ok(Box::new(MemCred(
            self.0.clone(),
            format!("{service}/{user}"),
        )))
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl keyring::credential::CredentialApi for MemCred {
    fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
        // The race test parks migration's write of this one value until it releases the gate.
        while secret == GATED && !RELEASED.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(5));
        }
        self.0
            .lock()
            .unwrap()
            .insert(self.1.clone(), secret.to_vec());
        Ok(())
    }
    fn get_secret(&self) -> keyring::Result<Vec<u8>> {
        self.0
            .lock()
            .unwrap()
            .get(&self.1)
            .cloned()
            .ok_or(keyring::Error::NoEntry)
    }
    fn delete_credential(&self) -> keyring::Result<()> {
        self.0
            .lock()
            .unwrap()
            .remove(&self.1)
            .map(|_| ())
            .ok_or(keyring::Error::NoEntry)
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}

fn mem() -> Mem {
    static MEM: std::sync::OnceLock<Mem> = std::sync::OnceLock::new();
    MEM.get_or_init(|| {
        let m: Mem = Default::default();
        keyring::set_default_credential_builder(Box::new(MemBuilder(m.clone())));
        m
    })
    .clone()
}

fn dir(name: &str) -> PathBuf {
    mem();
    let dir = std::env::temp_dir().join(format!("agentql-kc-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn file_text(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join("secrets.local.json")).unwrap_or_default()
}

fn in_keychain(value: &str) -> bool {
    mem()
        .lock()
        .unwrap()
        .values()
        .any(|v| v == value.as_bytes())
}

#[test]
fn save_goes_to_keychain_not_file() {
    let dir = dir("save");
    let store = Store::new(dir.clone());
    store
        .set_provider_api_key("anthropic", Some("sk-kc-save"))
        .unwrap();
    assert!(in_keychain("sk-kc-save"));
    assert!(!file_text(&dir).contains("sk-kc-save"));
    assert_eq!(
        store.provider_api_key("anthropic").as_deref(),
        Some("sk-kc-save")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn existing_plaintext_moves_into_keychain() {
    let dir = dir("migrate");
    std::fs::write(
        dir.join("secrets.local.json"),
        r#"{"m1:password":"pw-migrate","llm:openai":"sk-migrate"}"#,
    )
    .unwrap();
    let store = Store::new(dir.clone());
    assert_eq!(
        store.secret_storage(),
        "file",
        "plaintext entries exist before migrating"
    );
    assert_eq!(store.migrate_plaintext_secrets(), 2);
    assert!(in_keychain("pw-migrate") && in_keychain("sk-migrate"));
    let left = file_text(&dir);
    assert!(
        !left.contains("pw-migrate") && !left.contains("sk-migrate"),
        "file still holds: {left}"
    );
    assert_eq!(
        store.connection_secrets("m1").password.as_deref(),
        Some("pw-migrate")
    );
    assert_eq!(store.secret_storage(), "keychain");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn allowed_plaintext_is_not_used_when_keychain_works() {
    let dir = dir("allowed");
    let store = Store::new(dir.clone());
    store
        .save_settings(&Settings {
            allow_plaintext_secrets: true,
            ..Default::default()
        })
        .unwrap();
    store
        .set_provider_api_key("groq", Some("sk-allowed"))
        .unwrap();
    assert!(in_keychain("sk-allowed"));
    assert!(!file_text(&dir).contains("sk-allowed"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn save_during_migration_is_not_reverted() {
    let dir = dir("race");
    std::fs::write(
        dir.join("secrets.local.json"),
        r#"{"llm:race":"old-gated"}"#,
    )
    .unwrap();
    let store = Arc::new(Store::new(dir.clone()));
    let migrating = {
        let s = store.clone();
        std::thread::spawn(move || s.migrate_plaintext_secrets())
    };
    std::thread::sleep(Duration::from_millis(100)); // migration is now parked writing "old-gated"
    let saving = {
        let s = store.clone();
        std::thread::spawn(move || s.set_provider_api_key("race", Some("new-value")).unwrap())
    };
    std::thread::sleep(Duration::from_millis(100));
    RELEASED.store(true, Ordering::SeqCst);
    migrating.join().unwrap();
    saving.join().unwrap();
    assert_eq!(store.provider_api_key("race").as_deref(), Some("new-value"));
    assert!(!file_text(&dir).contains("old-gated"));
    let _ = std::fs::remove_dir_all(&dir);
}
