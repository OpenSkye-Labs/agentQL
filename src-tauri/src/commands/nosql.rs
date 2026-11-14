//! Redis and MongoDB commands.

use super::*;

// ----------------------------------------------------------------- redis

#[tauri::command]
pub async fn redis_scan(
    st: State<'_, AppState>,
    id: String,
    cursor: String,
    pattern: String,
    count: u32,
) -> Result<ScanResult> {
    let s = st.manager.get(&id).await?;
    redis(&s)?
        .scan(&cursor, &pattern, count.clamp(10, 1000))
        .await
}

#[tauri::command]
pub async fn redis_get(st: State<'_, AppState>, id: String, key: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    redis(&s)?.get_key(&key).await
}

#[tauri::command]
pub async fn redis_command(st: State<'_, AppState>, id: String, command: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only && !crate::db::redis::is_read_only_command(&command) {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    redis(&s)?.command(&command).await
}

#[tauri::command]
pub async fn redis_exec(st: State<'_, AppState>, id: String, args: Vec<String>) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only && !crate::db::redis::is_read_only_args(&args) {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    redis(&s)?.exec(&args).await
}

/// A Redis command as typed in the console, or as structured args.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum RedisCmd {
    Line(String),
    Args(Vec<String>),
}

/// Whether a Redis command writes, by the read-only allow-list (unknown = write), so the production prompt and
/// read-only enforcement never disagree.
#[tauri::command]
pub fn redis_is_write(cmd: RedisCmd) -> Result<bool> {
    Ok(match cmd {
        RedisCmd::Line(line) => !crate::db::redis::is_read_only_command(&line),
        RedisCmd::Args(args) => !crate::db::redis::is_read_only_args(&args),
    })
}

#[tauri::command]
pub async fn redis_info(st: State<'_, AppState>, id: String) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    redis(&s)?.info().await
}

// ----------------------------------------------------------------- mongo

/// What an aggregation pipeline writes (`$out` / `$merge` and the target collection), or null when it is read-only.
#[tauri::command]
pub fn mongo_pipeline_write_target(pipeline: Value) -> Result<Option<String>> {
    Ok(crate::db::mongo::pipeline_write_target(&pipeline))
}

#[tauri::command]
pub async fn mongo_collections(
    st: State<'_, AppState>,
    id: String,
    db: String,
) -> Result<Vec<Value>> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.collections(&db).await
}

#[tauri::command]
pub async fn mongo_find(
    st: State<'_, AppState>,
    id: String,
    query: MongoFind,
) -> Result<crate::db::mongo::MongoPage> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.find(&query).await
}

#[tauri::command]
pub async fn mongo_aggregate(
    st: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    pipeline: Value,
    limit: Option<usize>,
) -> Result<Vec<Value>> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only && crate::db::mongo::pipeline_writes(&pipeline) {
        return Err(AppError::Msg(
            "connection is read-only ($out/$merge not allowed)".into(),
        ));
    }
    mongo(&s)?
        .aggregate(&db, &collection, &pipeline, limit.unwrap_or(500))
        .await
}

#[tauri::command]
pub async fn mongo_insert(
    st: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    document: Value,
) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?.insert(&db, &collection, &document).await
}

#[tauri::command]
pub async fn mongo_replace(
    st: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
    document: Value,
) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?
        .replace(&db, &collection, &doc_id, &document)
        .await
}

#[tauri::command]
pub async fn mongo_delete(
    st: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    mongo(&s)?.delete(&db, &collection, &doc_id).await
}

#[tauri::command]
pub async fn mongo_collection_info(
    st: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    mongo(&s)?.collection_info(&db, &collection).await
}

#[tauri::command]
pub async fn mongo_command(
    st: State<'_, AppState>,
    id: String,
    db: String,
    command: Value,
) -> Result<Value> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only && !crate::db::mongo::is_read_only_command(&command) {
        return Err(AppError::Msg(
            "connection is read-only; only read commands are allowed".into(),
        ));
    }
    mongo(&s)?.run_command(&db, &command).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The production prompt must agree with read-only enforcement: same classifiers, unknown = write.
    #[test]
    fn write_classifiers_match_read_only_mode() {
        let line = |s: &str| RedisCmd::Line(s.into());
        let args = |a: &[&str]| RedisCmd::Args(a.iter().map(|s| s.to_string()).collect());
        assert!(!redis_is_write(line(r#"GET "my key""#)).unwrap());
        assert!(redis_is_write(line(r#"SET "my key" v"#)).unwrap());
        assert!(redis_is_write(line("FROBNICATE x")).unwrap());
        // PFCOUNT may rewrite the HyperLogLog's cached cardinality, so Redis itself calls it a write.
        assert!(redis_is_write(line("PFCOUNT visitors")).unwrap());
        assert!(redis_is_write(args(&["DEL", "k"])).unwrap());
        assert!(!redis_is_write(args(&["HGETALL", "k"])).unwrap());
        // The UI sends a string or an array; both deserialise.
        assert!(matches!(
            serde_json::from_value(json!("GET k")).unwrap(),
            RedisCmd::Line(_)
        ));
        assert!(matches!(
            serde_json::from_value(json!(["GET", "k"])).unwrap(),
            RedisCmd::Args(_)
        ));
        let target = |p: Value| mongo_pipeline_write_target(p).unwrap();
        assert_eq!(
            target(json!([{"$match": {}}, {"$out": "users"}])).as_deref(),
            Some("$out replaces users")
        );
        assert_eq!(
            target(json!([{"$out": {"db": "auth", "coll": "users"}}])).as_deref(),
            Some("$out replaces auth.users")
        );
        assert_eq!(
            target(json!([{"$merge": "t"}])).as_deref(),
            Some("$merge into t")
        );
        assert_eq!(
            target(json!([{"$merge": {"into": {"db": "a", "coll": "t"}, "on": "_id"}}])).as_deref(),
            Some("$merge into a.t")
        );
        assert_eq!(target(json!([{"$match": {}}, {"$limit": 5}])), None);
        // Every pipeline the read-only check calls a write gets a target line, and vice versa.
        for p in [
            json!([{"$out": 5}]),
            json!([{"$merge": {"into": 1}}]),
            json!([{"$limit": 1}]),
        ] {
            assert_eq!(
                target(p.clone()).is_some(),
                crate::db::mongo::pipeline_writes(&p)
            );
        }
    }
}
