#![cfg(unix)]
use agentql_lib::config::{Settings, Store};
use std::any::Any;
use std::os::unix::fs::PermissionsExt;

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
fn secrets_file_is_0600_even_with_stale_tmp() {
    keyring::set_default_credential_builder(Box::new(Refusing));
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("agentql-tmpmode-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::new(dir.clone());
    store
        .save_settings(&Settings {
            allow_plaintext_secrets: true,
            ..Default::default()
        })
        .unwrap();
    let tmp = dir.join("secrets.local.json.tmp");
    std::fs::write(&tmp, b"{}").unwrap();
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644)).unwrap();
    store
        .set_provider_api_key("x", Some("sk-dummy-not-real"))
        .unwrap();
    let mode = std::fs::metadata(dir.join("secrets.local.json"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(mode, 0o600, "secrets.local.json mode {mode:o}");
}
