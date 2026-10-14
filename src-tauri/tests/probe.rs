//! Read-only probe of real databases through the app's driver layer.
//!   PROBE_PG="host=127.0.0.1 port=5433 user=u password=p db=d" cargo test --test probe -- --ignored --nocapture
//!   PROBE_REDIS="host=127.0.0.1 port=6379 db=0" cargo test --test probe -- --ignored --nocapture
//! Everything runs in the database-enforced read-only context the UI uses for browsing.

use agentql_lib::config::{ConnectionConfig, ConnectionSecrets, Driver};
use agentql_lib::db::{Live, Manager, TableQuery};
use std::collections::HashMap;

fn parse(spec: &str) -> HashMap<String, String> {
    spec.split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn config(driver: Driver, kv: &HashMap<String, String>) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("probe-{driver:?}"),
        name: "probe".into(),
        driver,
        color: None,
        group: None,
        url: None,
        host: kv
            .get("host")
            .cloned()
            .unwrap_or_else(|| "127.0.0.1".into()),
        port: kv
            .get("port")
            .and_then(|p| p.parse().ok())
            .unwrap_or(driver.default_port()),
        user: kv.get("user").cloned().unwrap_or_default(),
        database: kv.get("db").cloned().unwrap_or_default(),
        file_path: None,
        ssl_mode: Some("disable".into()),
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        ssh: None,
        read_only: true,
        environment: None,
        agent_scope: None,
        agent_remote_consent_at: None,
        options: HashMap::new(),
        created_at: None,
        updated_at: None,
    }
}

#[tokio::test]
#[ignore]
async fn postgres_probe() {
    let Ok(spec) = std::env::var("PROBE_PG") else {
        return;
    };
    let kv = parse(&spec);
    let m = Manager::new(std::env::temp_dir().as_path());
    let secrets = ConnectionSecrets {
        password: kv.get("password").cloned(),
        ..Default::default()
    };
    let sess = m
        .connect(config(Driver::Postgres, &kv), &secrets)
        .await
        .expect("connect");
    let Live::Sql(db) = &sess.live else { panic!() };
    let v = db
        .run_one_read_only("SHOW server_version", 1)
        .await
        .unwrap();
    println!("== connected: PostgreSQL {}", v.rows[0][0]);
    println!("== databases: {:?}", db.databases().await.unwrap());
    for schema in db.schemas().await.unwrap() {
        let tables = db.tables(&schema).await.unwrap();
        println!("== schema {schema}: {} objects", tables.len());
        for t in tables.iter().take(40) {
            println!(
                "   {:<8} {:<40} ~{} rows",
                t.kind,
                t.name,
                t.row_estimate.map(|n| n.to_string()).unwrap_or("?".into())
            );
        }
        if let Some(t) = tables.iter().find(|t| t.kind == "table") {
            let d = db.table_details(&schema, &t.name).await.unwrap();
            println!(
                "== details of {}.{}: {} columns, {} indexes, {} fks",
                schema,
                t.name,
                d.columns.len(),
                d.indexes.len(),
                d.foreign_keys.len()
            );
            for c in d.columns.iter().take(12) {
                println!(
                    "   {:<28} {:<22} {}{}",
                    c.name,
                    c.data_type,
                    if c.is_primary { "PK " } else { "" },
                    if c.nullable { "null" } else { "not null" }
                );
            }
            let q = TableQuery {
                schema: Some(schema.clone()),
                table: t.name.clone(),
                filter: None,
                order_by: None,
                order_desc: false,
                limit: 3,
                offset: 0,
            };
            let page = db.run_one_read_only(&db.select_sql(&q), 3).await.unwrap();
            println!("== browse SQL: {}", db.select_sql(&q));
            println!(
                "== first rows ({} ms): {}",
                page.duration_ms,
                serde_json::to_string(&page.rows)
                    .unwrap()
                    .chars()
                    .take(600)
                    .collect::<String>()
            );
            println!("== count: {}", db.count(&q).await.unwrap());
            let plan = db
                .run_one_read_only(&db.explain_sql(&db.select_sql(&q), false), 50)
                .await
                .unwrap();
            println!(
                "== explain: {}",
                plan.rows
                    .iter()
                    .map(|r| r[0].as_str().unwrap_or(""))
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
        }
    }
    let blocked = db
        .run_one_read_only("CREATE TABLE agentql_should_not_exist (id int)", 1)
        .await;
    println!(
        "== write attempt on read-only connection: {}",
        blocked
            .err()
            .map(|e| e.to_string())
            .unwrap_or("UNEXPECTEDLY SUCCEEDED".into())
    );
}

/// pgvector round trip: `PROBE_PGVECTOR="host=127.0.0.1 port=5440 user=u password=p db=d"` against a database
/// holding `items(id, label, emb vector(3))` with rows `[1,0.5,0.1]`, `[0,-0.25,2]`, NULL and an hnsw index.
#[tokio::test]
#[ignore]
async fn pgvector_probe() {
    let Ok(spec) = std::env::var("PROBE_PGVECTOR") else {
        return;
    };
    let kv = parse(&spec);
    let m = Manager::new(std::env::temp_dir().as_path());
    let secrets = ConnectionSecrets {
        password: kv.get("password").cloned(),
        ..Default::default()
    };
    let sess = m
        .connect(config(Driver::Postgres, &kv), &secrets)
        .await
        .expect("connect");
    let Live::Sql(db) = &sess.live else { panic!() };
    let r = db
        .run_one_read_only("SELECT id, emb FROM items ORDER BY id", 10)
        .await
        .unwrap();
    println!("== rows: {}", serde_json::to_string(&r.rows).unwrap());
    assert_eq!(r.rows[0][1], serde_json::json!([1.0, 0.5, 0.1]));
    assert_eq!(r.rows[1][1], serde_json::json!([0.0, -0.25, 2.0]));
    assert!(r.rows[2][1].is_null());
    let knn = db
        .run_one_read_only(
            "SELECT id, emb <=> '[1,0.5,0.1]' AS d FROM items WHERE emb IS NOT NULL ORDER BY d LIMIT 2",
            10,
        )
        .await
        .unwrap();
    println!("== knn: {}", serde_json::to_string(&knn.rows).unwrap());
    assert_eq!(knn.rows[0][0], serde_json::json!(1));
    let d = db.table_details("public", "items").await.unwrap();
    let idx = d
        .indexes
        .iter()
        .find(|i| i.name == "items_emb_hnsw")
        .unwrap();
    println!("== index def: {:?}", idx.definition);
    assert!(idx.definition.as_deref().unwrap().contains("USING hnsw"));
    assert_eq!(idx.method.as_deref(), Some("hnsw"));
    assert_eq!(idx.opclasses, vec!["vector_cosine_ops"]);
    assert_eq!(idx.options, vec!["m=16", "ef_construction=64"]);
    assert_eq!(
        d.columns
            .iter()
            .find(|c| c.name == "emb")
            .unwrap()
            .data_type,
        "vector(3)"
    );
}

#[tokio::test]
#[ignore]
async fn redis_probe() {
    let Ok(spec) = std::env::var("PROBE_REDIS") else {
        return;
    };
    let kv = parse(&spec);
    let m = Manager::new(std::env::temp_dir().as_path());
    let sess = m
        .connect(config(Driver::Redis, &kv), &ConnectionSecrets::default())
        .await
        .expect("connect");
    let Live::Redis(r) = &sess.live else { panic!() };
    let info = r.info().await.unwrap();
    println!(
        "== connected: Redis {} · {} keys · {}",
        info["redis_version"], info["dbsize"], info["used_memory_human"]
    );
    let scan = r.scan("0", "*", 20).await.unwrap();
    for k in &scan.keys {
        println!("   {:<7} ttl={:<6} {}", k.kind, k.ttl, k.key);
    }
    if let Some(k) = scan.keys.first() {
        let v = r.get_key(&k.key).await.unwrap();
        println!(
            "== value of {}: {}",
            k.key,
            serde_json::to_string(&v["value"])
                .unwrap()
                .chars()
                .take(300)
                .collect::<String>()
        );
    }
    println!(
        "== read-only classifier: GET → {}, DEL → {}",
        agentql_lib::db::redis::is_read_only_command("GET x"),
        agentql_lib::db::redis::is_read_only_command("DEL x")
    );
}
