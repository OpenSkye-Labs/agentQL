//! Live driver smoke tests. Run with the throwaway containers up:
//!   cargo test --test live -- --ignored --nocapture
//! Ports match the `docker run` lines in docs/TESTING.md.

use agentql_lib::config::{ConnectionConfig, ConnectionSecrets, Driver};
use agentql_lib::db::{Live, Manager, RowChange, TableQuery};
use serde_json::{Value, json};
use std::collections::HashMap;

const T: &str = "agentql_smoke";

fn cfg(driver: Driver, port: u16, user: &str, database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("test-{driver:?}"),
        name: "test".into(),
        driver,
        color: None,
        group: None,
        url: None,
        host: "127.0.0.1".into(),
        port,
        user: user.into(),
        database: database.into(),
        file_path: None,
        ssl_mode: Some("disable".into()),
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        ssh: None,
        read_only: false,
        agent_scope: None,
        agent_remote_consent_at: None,
        options: HashMap::new(),
        created_at: None,
        updated_at: None,
    }
}

fn secrets(pw: &str) -> ConnectionSecrets {
    ConnectionSecrets {
        password: Some(pw.into()),
        ssh_password: None,
        ssh_key_passphrase: None,
    }
}

async fn sql_roundtrip(c: ConnectionConfig, s: ConnectionSecrets, schema: &str) {
    let m = Manager::new(std::env::temp_dir().as_path());
    let sess = m.connect(c.clone(), &s).await.expect("connect");
    let Live::Sql(db) = &sess.live else {
        panic!("not sql")
    };
    let (ser, ts) = match c.driver {
        Driver::Postgres => ("SERIAL PRIMARY KEY", "TIMESTAMPTZ"),
        Driver::Sqlite => ("INTEGER PRIMARY KEY AUTOINCREMENT", "TEXT"),
        _ => ("INT AUTO_INCREMENT PRIMARY KEY", "DATETIME"),
    };
    let drop_scratch = format!("DROP TABLE IF EXISTS {T}");
    db.run(&drop_scratch, 10).await.unwrap();
    db.run(&format!("CREATE TABLE {T} (id {ser}, name VARCHAR(50) NOT NULL, score DECIMAL(10,2), active BOOLEAN, created {ts} NULL, note TEXT)"), 10).await.unwrap();
    let r = db.run(&format!("INSERT INTO {T} (name, score, active, note) VALUES ('ann', 1.5, true, 'x'), ('bob', 22.25, false, NULL)"), 10).await.unwrap();
    assert_eq!(r[0].affected, Some(2));

    // multi-statement + decoding
    let res = db
        .run(
            &format!("SELECT * FROM {T} ORDER BY id; SELECT COUNT(*) AS n FROM {T}"),
            100,
        )
        .await
        .unwrap();
    assert_eq!(res.len(), 2);
    assert_eq!(res[0].rows.len(), 2);
    assert_eq!(res[0].rows[0][1], json!("ann"));
    assert_eq!(res[0].rows[1][5], Value::Null);
    let dec = &res[0].rows[0][2];
    assert!(
        dec.as_str().map(|s| s.starts_with("1.5")).unwrap_or(false) || dec.as_f64() == Some(1.5),
        "decimal {dec:?}"
    );
    println!(
        "{:?} columns: {:?}",
        c.driver,
        res[0]
            .columns
            .iter()
            .map(|c| format!("{}:{}", c.name, c.type_name))
            .collect::<Vec<_>>()
    );

    // empty result still has headers
    let empty = db
        .run_one(&format!("SELECT * FROM {T} WHERE 1 = 0"), 10)
        .await
        .unwrap();
    assert_eq!(empty.columns.len(), 6, "{:?}", empty.columns);

    // introspection
    let schemas = db.schemas().await.unwrap();
    assert!(schemas.iter().any(|s| s == schema), "{schemas:?}");
    let tables = db.tables(schema).await.unwrap();
    assert!(tables.iter().any(|t| t.name == T), "{tables:?}");
    let d = db.table_details(schema, T).await.unwrap();
    assert_eq!(d.columns.len(), 6);
    assert!(d.columns[0].is_primary);
    assert!(d.ddl.as_deref().unwrap_or("").to_lowercase().contains(T));

    // browse + count + read-only enforcement
    let q = TableQuery {
        schema: Some(schema.into()),
        table: T.into(),
        filter: Some("score > 2".into()),
        order_by: Some("id".into()),
        order_desc: true,
        limit: 10,
        offset: 0,
    };
    let page = db.run_one_read_only(&db.select_sql(&q), 10).await.unwrap();
    assert_eq!(page.rows.len(), 1);
    assert_eq!(db.count(&q).await.unwrap(), 1);
    let blocked = db.run_one_read_only(&format!("DELETE FROM {T}"), 10).await;
    assert!(blocked.is_err(), "read-only context must block writes");
    assert_eq!(
        db.count(&TableQuery {
            filter: None,
            ..q.clone()
        })
        .await
        .unwrap(),
        2
    );

    // edits -> sql -> apply
    let mut key = HashMap::new();
    key.insert("id".to_string(), json!(1));
    let mut values = HashMap::new();
    values.insert("name".to_string(), json!("ann 'quoted'"));
    values.insert("score".to_string(), json!(9.75));
    let mut types = HashMap::new();
    for col in &d.columns {
        types.insert(col.name.clone(), col.data_type.clone());
    }
    let stmts = db.change_sql(
        Some(schema),
        T,
        &[
            RowChange::Update {
                key: key.clone(),
                values,
            },
            RowChange::Delete {
                key: HashMap::from([("id".to_string(), json!(2))]),
            },
        ],
        &types,
    );
    println!("{stmts:#?}");
    assert_eq!(db.execute_batch(&stmts).await.unwrap(), 2);
    let after = db
        .run_one(&format!("SELECT name FROM {T}"), 10)
        .await
        .unwrap();
    assert_eq!(after.rows.len(), 1);
    assert_eq!(after.rows[0][0], json!("ann 'quoted'"));

    // explain
    let plan = db
        .run_one_read_only(&db.explain_sql(&format!("SELECT * FROM {T}"), false), 100)
        .await
        .unwrap();
    assert!(!plan.rows.is_empty());
    db.run(&drop_scratch, 10).await.unwrap();
    m.disconnect(&c.id).await;
}

#[tokio::test]
#[ignore]
async fn postgres() {
    sql_roundtrip(
        cfg(Driver::Postgres, 55432, "postgres", "demo"),
        secrets("secret"),
        "public",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn mysql() {
    sql_roundtrip(
        cfg(Driver::Mysql, 53306, "root", "demo"),
        secrets("secret"),
        "demo",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn mariadb() {
    sql_roundtrip(
        cfg(Driver::Mariadb, 53307, "root", "demo"),
        secrets("secret"),
        "demo",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn sqlite() {
    let path = std::env::temp_dir().join("agentql-smoke.sqlite");
    let _ = std::fs::remove_file(&path);
    let mut c = cfg(Driver::Sqlite, 0, "", "");
    c.file_path = Some(path.to_string_lossy().into_owned());
    sql_roundtrip(c, ConnectionSecrets::default(), "main").await;
}

#[tokio::test]
#[ignore]
async fn postgres_url_mode() {
    let m = Manager::new(std::env::temp_dir().as_path());
    let mut c = cfg(Driver::Postgres, 0, "", "");
    c.url = Some("postgres://postgres@127.0.0.1:55432/demo?sslmode=disable".into());
    let sess = m
        .connect(c, &secrets("secret"))
        .await
        .expect("connect by url with injected password");
    let Live::Sql(db) = &sess.live else { panic!() };
    let r = db.run_one("SELECT 1::int AS one, '{1,2,NULL}'::int[] AS arr, '{\"a\":1}'::jsonb AS j, '{x,\"y z\"}'::text[] AS t, now() AS ts, '-0.50'::money AS m", 1).await.unwrap();
    assert_eq!(r.rows[0][0], json!(1));
    assert_eq!(r.rows[0][1], json!([1, 2, null]));
    assert_eq!(r.rows[0][2], json!({"a": 1}));
    assert_eq!(r.rows[0][3], json!(["x", "y z"]));
    assert_eq!(r.rows[0][5], json!("-0.50"));
    println!("pg types: {:?}", r.rows[0]);
}

#[tokio::test]
#[ignore]
async fn redis() {
    let m = Manager::new(std::env::temp_dir().as_path());
    let sess = m
        .connect(
            cfg(Driver::Redis, 56379, "", "0"),
            &ConnectionSecrets::default(),
        )
        .await
        .expect("connect");
    let Live::Redis(r) = &sess.live else { panic!() };
    r.command("SET agentql:k1 hello").await.unwrap();
    r.command("HSET agentql:h f1 v1 f2 v2").await.unwrap();
    r.command("EXPIRE agentql:k1 100").await.unwrap();
    let scan = r.scan("0", "agentql:*", 100).await.unwrap();
    assert_eq!(scan.keys.len(), 2, "{scan:?}");
    let k = r.get_key("agentql:k1").await.unwrap();
    assert_eq!(k["value"], json!("hello"));
    assert!(k["ttl"].as_i64().unwrap() > 0);
    let h = r.get_key("agentql:h").await.unwrap();
    assert_eq!(h["value"]["f1"], json!("v1"));
    let info = r.info().await.unwrap();
    assert!(info.get("redis_version").is_some());
    r.command("DEL agentql:k1 agentql:h").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn mongo() {
    use agentql_lib::db::mongo::MongoFind;
    let m = Manager::new(std::env::temp_dir().as_path());
    let sess = m
        .connect(
            cfg(Driver::Mongodb, 57017, "", "demo"),
            &ConnectionSecrets::default(),
        )
        .await
        .expect("connect");
    let Live::Mongo(mg) = &sess.live else {
        panic!()
    };
    let id = mg
        .insert("demo", "smoke", &json!({"name": "ann", "score": 3}))
        .await
        .unwrap();
    mg.insert(
        "demo",
        "smoke",
        &json!({"name": "bob", "score": 7, "tags": ["a", "b"]}),
    )
    .await
    .unwrap();
    let page = mg
        .find(&MongoFind {
            db: "demo".into(),
            collection: "smoke".into(),
            filter: Some(json!({"score": {"$gt": 5}})),
            sort: Some(json!({"score": -1})),
            projection: None,
            limit: 10,
            skip: 0,
        })
        .await
        .unwrap();
    assert_eq!(page.docs.len(), 1);
    assert_eq!(page.docs[0]["name"], json!("bob"));
    let agg = mg
        .aggregate(
            "demo",
            "smoke",
            &json!([{"$group": {"_id": null, "total": {"$sum": "$score"}}}]),
            10,
        )
        .await
        .unwrap();
    assert_eq!(agg[0]["total"], json!(10));
    let cols = mg.collections("demo").await.unwrap();
    assert!(cols.iter().any(|c| c["name"] == "smoke"));
    let info = mg.collection_info("demo", "smoke").await.unwrap();
    assert!(info["fields"].get("name").is_some(), "{info}");
    assert_eq!(
        mg.replace("demo", "smoke", &id, &json!({"name": "ann2", "score": 4}))
            .await
            .unwrap(),
        1
    );
    assert_eq!(mg.delete("demo", "smoke", &id).await.unwrap(), 1);
    mg.run_command("demo", &json!({"drop": "smoke"}))
        .await
        .unwrap();
}
