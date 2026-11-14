//! A refusing keychain: migration gives up after the first refused entry instead of paying one slow
//! keychain timeout per entry.
//!   cargo test --test secret_store_migration_stops

use agentql_lib::config::Store;
use std::any::Any;
use std::sync::atomic::{AtomicUsize, Ordering};

static CALLS: AtomicUsize = AtomicUsize::new(0);

struct CountingRefusal;
impl keyring::credential::CredentialBuilderApi for CountingRefusal {
    fn build(
        &self,
        _: Option<&str>,
        _: &str,
        user: &str,
    ) -> keyring::Result<Box<keyring::credential::Credential>> {
        if user.starts_with("stop-") {
            CALLS.fetch_add(1, Ordering::SeqCst);
        }
        Err(keyring::Error::NoStorageAccess(
            "test keychain refuses".into(),
        ))
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[test]
fn migration_stops_at_first_refusal() {
    keyring::set_default_credential_builder(Box::new(CountingRefusal));
    let dir = std::env::temp_dir().join(format!("agentql-stop-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("secrets.local.json"),
        r#"{"stop-a:password":"a","stop-b:password":"b","stop-c:password":"c"}"#,
    )
    .unwrap();
    let store = Store::new(dir.clone());
    assert_eq!(store.migrate_plaintext_secrets(), 0);
    let calls = CALLS.load(Ordering::SeqCst);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(calls, 1, "one keychain call, not one per entry");
}
