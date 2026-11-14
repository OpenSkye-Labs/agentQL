//! A keychain that refuses every call (WSL, headless, a dismissed unlock prompt). Secrets must not
//! land in the plaintext file unless the user turned that on.
//!   cargo test --test secret_store_refused

use agentql_lib::config::{ConnectionSecrets, Settings, Store};
use std::any::Any;
use std::path::PathBuf;

struct Refusing;
impl keyring::credential::CredentialBuilderApi for Refusing {
    fn build(
        &self,
        _: Option<&str>,
        _: &str,
        _: &str,
    ) -> keyring::Result<Box<keyring::credential::Credential>> {
        Err(keyring::Error::NoStorageAccess("test keychain refuses".into()))
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}

fn store(name: &str, allow_plaintext: bool) -> (Store, PathBuf) {
    keyring::set_default_credential_builder(Box::new(Refusing));
    let dir = std::env::temp_dir().join(format!("agentql-refused-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::new(dir.clone());
    store
        .save_settings(&Settings {
            allow_plaintext_secrets: allow_plaintext,
            ..Default::default()
        })
        .unwrap();
    (store, dir)
}

fn file_text(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join("secrets.local.json")).unwrap_or_default()
}

#[test]
fn opt_in_is_off_by_default() {
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert!(!s.allow_plaintext_secrets);
}

#[test]
fn refused_save_errors_and_writes_nothing_when_not_allowed() {
    let (store, dir) = store("off", false);
    let secrets = ConnectionSecrets {
        password: Some("hunter2-off".into()),
        ..Default::default()
    };
    let err = store
        .save_connection_secrets("c1", &secrets)
        .expect_err("save must fail when the keychain refuses and plaintext is not allowed");
    assert!(
        err.to_string().contains("plaintext"),
        "error should name the plaintext setting: {err}"
    );
    assert!(!file_text(&dir).contains("hunter2-off"), "secret leaked into secrets.local.json");
    assert!(store.connection_secrets("c1").password.is_none());
    assert_eq!(store.secret_storage(), "none");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn refused_save_goes_to_file_when_allowed() {
    let (store, dir) = store("on", true);
    store
        .set_provider_api_key("anthropic", Some("sk-test-on"))
        .expect("save must succeed into the plaintext file when allowed");
    assert!(file_text(&dir).contains("sk-test-on"));
    assert_eq!(store.provider_api_key("anthropic").as_deref(), Some("sk-test-on"));
    assert_eq!(store.secret_storage(), "file");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn delete_still_works_when_refused() {
    let (store, dir) = store("del", true);
    store.set_provider_api_key("openai", Some("sk-del")).unwrap();
    store.save_settings(&Settings::default()).unwrap();
    store
        .set_provider_api_key("openai", None)
        .expect("removing a secret must work even with plaintext turned off");
    assert!(!file_text(&dir).contains("sk-del"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn migration_keeps_entries_the_keychain_refuses() {
    let (_, dir) = store("mig", false);
    let before = r#"{"c9:password":"kept-in-file"}"#;
    std::fs::write(dir.join("secrets.local.json"), before).unwrap();
    let store = Store::new(dir.clone());
    assert_eq!(store.migrate_plaintext_secrets(), 0);
    assert!(file_text(&dir).contains("kept-in-file"));
    assert_eq!(store.connection_secrets("c9").password.as_deref(), Some("kept-in-file"));
    assert_eq!(store.secret_storage(), "file");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn refused_connection_save_leaves_no_config_behind() {
    let (store, dir) = store("conn", false);
    let config: agentql_lib::config::ConnectionConfig = serde_json::from_value(serde_json::json!({
        "id": "", "name": "prod", "driver": "postgres", "host": "db", "port": 5432,
        "username": "app", "database": "app"
    }))
    .unwrap();
    let secrets = ConnectionSecrets {
        password: Some("pw-conn".into()),
        ..Default::default()
    };
    assert!(agentql_lib::commands::store_connection(&store, config, Some(secrets)).is_err());
    assert!(store.connections().is_empty(), "a retry would leave a duplicate without its password");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn corrupt_secrets_file_is_renamed_not_wiped() {
    let (_, dir) = store("corrupt", true);
    let bad: &[u8] = b"{\"c1:password\":\"half";
    std::fs::write(dir.join("secrets.local.json"), bad).unwrap();
    let store = Store::new(dir.clone());
    store.set_provider_api_key("x", Some("sk-after")).unwrap();
    let kept = std::fs::read(dir.join("secrets.local.json.corrupt")).unwrap_or_default();
    assert_eq!(kept, bad, "the unparseable file must survive as secrets.local.json.corrupt");
    let _ = std::fs::remove_dir_all(&dir);
}
