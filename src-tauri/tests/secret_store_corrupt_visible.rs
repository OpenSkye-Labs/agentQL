use agentql_lib::config::Store;
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
fn corrupt_plaintext_file_is_reported() {
    keyring::set_default_credential_builder(Box::new(Refusing));
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("agentql-corrupt-visible-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("secrets.local.json"),
        b"{\"c1:password\":\"dummy-pw",
    )
    .unwrap();
    let store = Store::new(dir.clone());
    assert!(dir.join("secrets.local.json.corrupt").exists());
    let s = store.secret_storage();
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(
        s, "file",
        "plaintext .corrupt file on disk but secret_storage says {s}"
    );
}
