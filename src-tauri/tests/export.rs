//! Streaming export against a real SQLite file: every row reaches disk, cancel and failure leave no file, and the
//! read-only session refuses writes.

use agentql_lib::config::{ConnectionConfig, ConnectionSecrets};
use agentql_lib::db::sql::SqlConn;
use agentql_lib::export::{Format, Job, cancel, export_query};
use std::path::PathBuf;

const ROWS: usize = 200_000;

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("agentql-export-it-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

async fn fixture(d: &std::path::Path) -> SqlConn {
    let cfg: ConnectionConfig = serde_json::from_value(serde_json::json!({
        "id": "t", "name": "t", "driver": "sqlite",
        "file_path": d.join("big.db").to_string_lossy(),
    }))
    .unwrap();
    let c = SqlConn::connect(&cfg, &ConnectionSecrets::default())
        .await
        .unwrap();
    c.execute_batch(&[
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT, score REAL)".into(),
        format!(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {ROWS}) \
             INSERT INTO t SELECT i, 'row ' || i, i * 0.5 FROM n"
        ),
    ])
    .await
    .unwrap();
    c
}

#[tokio::test(flavor = "multi_thread")]
async fn exports_every_row_and_cleans_up_on_cancel_or_failure() {
    let d = dir("all");
    let c = fixture(&d).await;

    // Every row, header first.
    let out = d.join("all.csv");
    let n = export_query(
        &c,
        Job::start("full".into()),
        "SELECT * FROM t ORDER BY id",
        out.clone(),
        Format::Csv,
        false,
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(n, ROWS);
    let text = std::fs::read_to_string(&out).unwrap();
    assert_eq!(text.lines().count(), ROWS + 1);
    assert_eq!(text.lines().next(), Some("id,label,score"));
    assert_eq!(
        text.lines().last(),
        Some(format!("{ROWS},row {ROWS},100000.0").as_str())
    );

    // Cancel (here before the first row, deterministically): error, no file, no temp file. The mid-stream path is the
    // same code: the stop is seen, the writer is dropped instead of finished.
    let out = d.join("cancelled.json");
    let job = Job::start("stop-me".into());
    assert!(cancel("stop-me"));
    let r = export_query(
        &c,
        job,
        "SELECT * FROM t",
        out.clone(),
        Format::Json,
        false,
        |_| {},
    )
    .await;
    assert!(r.unwrap_err().to_string().contains("cancelled"));
    assert!(!out.exists());
    assert!(!cancel("stop-me"), "the job is unregistered once it ends");

    // A write cannot run through the export session (a read-only SQLite connection), and leaves no file.
    let out = d.join("write.csv");
    let r = export_query(
        &c,
        Job::start("w".into()),
        "DELETE FROM t RETURNING id",
        out.clone(),
        Format::Csv,
        false,
        |_| {},
    )
    .await;
    assert!(r.is_err());
    assert!(!out.exists());
    let left = c.run_one("SELECT COUNT(*) AS n FROM t", 1).await.unwrap();
    assert_eq!(left.rows[0][0], serde_json::json!(ROWS));

    // Only the database and the one finished export remain: no temp files.
    let mut names: Vec<String> = std::fs::read_dir(&d)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with("big.db"))
        .collect();
    names.sort();
    assert_eq!(names, vec!["all.csv"]);
}
