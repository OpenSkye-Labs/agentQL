use agentql_lib::commands::remove_connection;
use agentql_lib::config::Store;

#[test]
fn unparseable_connections_json_is_not_wiped() {
    let dir = std::env::temp_dir().join(format!("agentql-corrupt-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("connections.json");
    let bad: &[u8] = b"[{\"id\":\"a\",\"name\":\"prod\",";
    std::fs::write(&file, bad).unwrap();
    let store = Store::new(dir.clone());
    let ok = remove_connection(&store, "other").is_ok();
    let after = std::fs::read(&file).unwrap_or_default();
    let kept = after == bad || dir.join("connections.json.corrupt").exists();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        kept,
        "connections.json was overwritten (ok={ok}): {}",
        String::from_utf8_lossy(&after)
    );
}
