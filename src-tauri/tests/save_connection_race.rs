//! Every writer of connections.json (save, delete, agent scope, remote consent) can run concurrently once save is
//! async; none may drop another's change.
//!   cargo test --test save_connection_race

use agentql_lib::commands::{remove_connection, store_connection, update_connections};
use agentql_lib::config::{ConnectionConfig, Store};
use std::sync::Arc;

fn sqlite(name: &str) -> ConnectionConfig {
    serde_json::from_value(serde_json::json!({
        "id": "", "name": name, "driver": "sqlite", "file_path": format!("/tmp/{name}.db"),
    }))
    .unwrap()
}

#[test]
fn concurrent_saves_and_deletes_keep_every_change() {
    let dir = std::env::temp_dir().join(format!("agentql-race-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let store = Arc::new(Store::new(dir.clone()));
    // No secrets, so the keychain is never touched.
    let old: Vec<String> = (0..10)
        .map(|i| {
            store_connection(&store, sqlite(&format!("old{i}")), None)
                .unwrap()
                .id
        })
        .collect();
    let kept: Vec<String> = (0..5)
        .map(|i| {
            store_connection(&store, sqlite(&format!("kept{i}")), None)
                .unwrap()
                .id
        })
        .collect();

    let saves = (0..20).map(|i| {
        let store = store.clone();
        std::thread::spawn(move || {
            store_connection(&store, sqlite(&format!("new{i}")), None).unwrap();
        })
    });
    let deletes = old.into_iter().map(|id| {
        let store = store.clone();
        std::thread::spawn(move || remove_connection(&store, &id).unwrap())
    });
    // What set_agent_scope and the consent write do: edit one field of an existing connection.
    let edits = kept.into_iter().map(|id| {
        let store = store.clone();
        std::thread::spawn(move || {
            update_connections(&store, |list| {
                let c = list.iter_mut().find(|c| c.id == id).unwrap();
                c.color = Some("edited".into());
                Ok(())
            })
            .unwrap()
        })
    });
    let threads: Vec<_> = saves.chain(deletes).chain(edits).collect();
    threads.into_iter().for_each(|t| t.join().unwrap());

    let list = store.connections();
    let mut names: Vec<_> = list.iter().map(|c| c.name.clone()).collect();
    names.sort();
    let mut want: Vec<_> = (0..20)
        .map(|i| format!("new{i}"))
        .chain((0..5).map(|i| format!("kept{i}")))
        .collect();
    want.sort();
    assert_eq!(names, want);
    let edited = list
        .iter()
        .filter(|c| c.color.as_deref() == Some("edited"))
        .count();
    assert_eq!(edited, 5, "every kept connection keeps its edit");
    let _ = std::fs::remove_dir_all(&dir);
}
