//! The keychain commands now run inside `spawn_blocking` (a tokio thread). The keyring backend panics when it
//! blocks inside a runtime, so this proves `off_runtime` still shields it there. Read-only: looks up an id that
//! does not exist, so nothing is written to the keychain and no unlock prompt appears.
//!   cargo test --test keychain_off_main

use agentql_lib::config::Store;
use std::sync::Arc;

#[test]
fn keychain_read_works_from_spawn_blocking() {
    let dir = std::env::temp_dir().join(format!("agentql-kc-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let store = Arc::new(Store::new(dir.clone()));
    let secrets = tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(move || {
        store.connection_secrets("agentql-test-no-such-connection")
    }))
    .expect("keychain lookup panicked on a spawn_blocking thread");
    assert!(secrets.password.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}
