//! A refusing keychain with the plaintext setting off: an empty password is not a secret, so saving a
//! passwordless connection must not need the keychain or the plaintext opt-in.
//!   cargo test --test secret_store_empty_password

use agentql_lib::config::{ConnectionConfig, ConnectionSecrets, Settings, Store};
use std::any::Any;

struct Refusing;
impl keyring::credential::CredentialBuilderApi for Refusing {
    fn build(
        &self,
        _: Option<&str>,
        _: &str,
        _: &str,
    ) -> keyring::Result<Box<keyring::credential::Credential>> {
        Err(keyring::Error::NoStorageAccess(
            "test keychain refuses".into(),
        ))
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[test]
fn cleared_password_field_saves_without_keychain() {
    keyring::set_default_credential_builder(Box::new(Refusing));
    let dir = std::env::temp_dir().join(format!("agentql-empty-pw-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::new(dir.clone());
    store.save_settings(&Settings::default()).unwrap(); // allow_plaintext_secrets: false
    let config: ConnectionConfig = serde_json::from_value(serde_json::json!({
        "id": "", "name": "local", "driver": "postgres", "host": "localhost", "port": 5432,
        "username": "app", "database": "app"
    }))
    .unwrap();
    // What ConnectionDialog sends after the user types in Password and clears it again.
    let secrets = ConnectionSecrets {
        password: Some(String::new()),
        ..Default::default()
    };
    agentql_lib::commands::store_connection(&store, config, Some(secrets))
        .unwrap_or_else(|e| panic!("empty password needs no keychain: {e}"));
    assert_eq!(store.connections().len(), 1);
    let _ = std::fs::remove_dir_all(&dir);
}
