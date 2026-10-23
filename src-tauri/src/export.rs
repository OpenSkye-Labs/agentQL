//! Streaming export: CSV / JSON / SQL INSERTs written row by row. Output goes to a uniquely named temp file next to
//! the target, created exclusively (never through an existing file or symlink), and is renamed over the target only
//! by `finish`, so a cancelled or failed export leaves no half-written file and never replaces an existing one.

use crate::commands::blocking;
use crate::db::sql::SqlConn;
use crate::db::{Batch, Stop};
use crate::error::{AppError, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Messages in flight between the database and the writer thread (each up to `BATCH_ROWS` rows).
const QUEUE: usize = 4;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Csv,
    Json,
    Sql,
}

/// How SQL-format output is written for the source database.
#[derive(Clone, Debug, Default)]
pub struct SqlStyle {
    /// MySQL/MariaDB: backtick identifiers (double quotes are string literals there by default), and strings with a
    /// backslash written as hex literals (a backslash means different things depending on NO_BACKSLASH_ESCAPES).
    pub mysql: bool,
    /// The already-quoted, schema-qualified table to insert into (table exports). None: the file name, quoted.
    pub table: Option<String>,
}

/// Running exports by id.
static JOBS: LazyLock<Mutex<HashMap<String, Arc<Stop>>>> = LazyLock::new(Default::default);

fn jobs() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Stop>>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// A registered export. Commands start it before anything else, so a Cancel that arrives while the connection is
/// still being looked up is not lost; dropping it unregisters the id.
pub struct Job {
    id: String,
    stop: Arc<Stop>,
}

impl Job {
    pub fn start(id: String) -> Job {
        let stop = Arc::new(Stop::default());
        jobs().insert(id.clone(), stop.clone());
        Job { id, stop }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        jobs().remove(&self.id);
    }
}

/// Ask a running export to stop. False when no export has that id (already done).
pub fn cancel(id: &str) -> bool {
    jobs().get(id).map(|s| s.stop()).is_some()
}

/// Export every row of a read-only statement to `path`. Rows stream from the database through a bounded channel to
/// a writer thread, which reports the rows written so far to `progress` (at most every 250 ms). The file only
/// replaces `path` when the read finished without error or cancel. `sql_style`: SQL-format dialect and target table.
/// ponytail: a re-run is a fresh session; volatile functions and session state (SET search_path) can differ from the
/// grid's run, and a long export holds one read-only transaction open.
pub async fn export_query(
    conn: &SqlConn,
    job: Job,
    sql: &str,
    path: PathBuf,
    format: Format,
    sql_style: SqlStyle,
    progress: impl Fn(usize) + Send + 'static,
) -> Result<usize> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Batch>(QUEUE);
    let writer = blocking(move || {
        let mut w = ExportWriter::create(&path, format)?.sql_style(sql_style);
        let mut last = Instant::now();
        while let Some(batch) = rx.blocking_recv() {
            match batch {
                Batch::Columns(c) => w.columns(&c)?,
                Batch::Rows(rows) => {
                    for r in &rows {
                        w.row(r)?;
                    }
                    if last.elapsed() >= PROGRESS_EVERY {
                        last = Instant::now();
                        progress(w.rows());
                    }
                }
            }
        }
        Ok(w)
    });
    let (read, writer) = tokio::join!(
        async {
            let r = conn.stream_read_only(sql, &tx, &job.stop).await;
            drop(tx);
            r
        },
        writer
    );
    // A writer error (disk full, permission) wins: the reader only saw its channel close.
    let w = writer?;
    let cancelled = job.stop.is_set();
    blocking(move || match (read, cancelled) {
        (Err(e), _) => Err(e),
        (Ok(_), true) => Err(AppError::Msg("Export cancelled".into())),
        (Ok(_), false) => w.finish(),
    })
    .await
}

enum Out {
    Csv(Box<csv::Writer<File>>),
    Plain(BufWriter<File>),
}

pub struct ExportWriter {
    format: Format,
    target: PathBuf,
    tmp: PathBuf,
    out: Option<Out>,
    columns: Vec<String>,
    /// SQL format: the target table, taken from the file name.
    table: String,
    style: SqlStyle,
    rows: usize,
}

fn cell(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        o => o.to_string(),
    }
}

impl ExportWriter {
    pub fn create(target: &Path, format: Format) -> Result<ExportWriter> {
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "export".into());
        // Unique and exclusive: two exports to one target never share a temp file, and a planted symlink fails the
        // open instead of being followed and truncated.
        let tmp = target.with_file_name(format!(".{name}.{}.agentql-part", uuid::Uuid::new_v4()));
        let file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        let out = match format {
            Format::Csv => Out::Csv(Box::new(csv::Writer::from_writer(file))),
            Format::Json => {
                let mut w = BufWriter::new(file);
                w.write_all(b"[")?;
                Out::Plain(w)
            }
            Format::Sql => Out::Plain(BufWriter::new(file)),
        };
        Ok(ExportWriter {
            format,
            target: target.to_path_buf(),
            tmp,
            out: Some(out),
            columns: vec![],
            table: target
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "export".into()),
            style: SqlStyle::default(),
            rows: 0,
        })
    }

    pub fn sql_style(mut self, style: SqlStyle) -> Self {
        self.style = style;
        self
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    /// Set the column names; call once, before the first row.
    pub fn columns(&mut self, columns: &[String]) -> Result<()> {
        self.columns = columns.to_vec();
        match self.out.as_mut() {
            Some(Out::Csv(w)) => Ok(w.write_record(columns)?),
            _ => Ok(()),
        }
    }

    pub fn row(&mut self, row: &[Value]) -> Result<()> {
        let mysql = self.style.mysql;
        let q = |s: &str| {
            if mysql {
                format!("`{}`", s.replace('`', "``"))
            } else {
                format!("\"{}\"", s.replace('"', "\"\""))
            }
        };
        match self.out.as_mut() {
            Some(Out::Csv(w)) => w.write_record(row.iter().map(cell))?,
            Some(Out::Plain(w)) if self.format == Format::Json => {
                let obj = Value::Object(
                    self.columns
                        .iter()
                        .cloned()
                        .zip(row.iter().cloned())
                        .collect(),
                );
                // Same layout as serializing the whole array with to_vec_pretty: each object indented two spaces.
                let body = serde_json::to_string_pretty(&obj)?.replace('\n', "\n  ");
                write!(w, "{}\n  {body}", if self.rows == 0 { "" } else { "," })?;
            }
            Some(Out::Plain(w)) => {
                let vals: Vec<String> = row
                    .iter()
                    .map(|v| match v {
                        Value::Null => "NULL".into(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string().to_uppercase(),
                        o => {
                            let text = cell(o);
                            // MySQL reads `\` as an escape unless NO_BACKSLASH_ESCAPES is on, so no quoting of a
                            // backslash means the same in both modes: such strings go out as a hex literal with an
                            // explicit charset, which every sql_mode reads byte for byte.
                            if mysql && text.contains('\\') {
                                let hex: String =
                                    text.bytes().map(|b| format!("{b:02X}")).collect();
                                format!("_utf8mb4 X'{hex}'")
                            } else {
                                format!("'{}'", text.replace('\'', "''"))
                            }
                        }
                    })
                    .collect();
                let table = self.style.table.clone().unwrap_or_else(|| q(&self.table));
                writeln!(
                    w,
                    "INSERT INTO {} ({}) VALUES ({});",
                    table,
                    self.columns
                        .iter()
                        .map(|c| q(c))
                        .collect::<Vec<_>>()
                        .join(", "),
                    vals.join(", ")
                )?;
            }
            None => return Err(AppError::Msg("export already finished".into())),
        }
        self.rows += 1;
        Ok(())
    }

    /// Flush, close and move the temp file over the target. Returns the number of rows written.
    pub fn finish(mut self) -> Result<usize> {
        let out = self.out.take();
        // The file is closed (dropped) before the rename: Windows cannot rename an open file.
        let done = (|| -> Result<()> {
            let file = match out {
                Some(Out::Csv(w)) => w.into_inner().map_err(|e| e.into_error())?,
                Some(Out::Plain(mut w)) => {
                    if self.format == Format::Json {
                        w.write_all(if self.rows == 0 { b"]" } else { b"\n]" })?;
                    }
                    w.into_inner().map_err(|e| e.into_error())?
                }
                None => return Err(AppError::Msg("export already finished".into())),
            };
            file.sync_all()?;
            drop(file);
            std::fs::rename(&self.tmp, &self.target)
                .map_err(|e| AppError::Msg(format!("saving {}: {e}", self.target.display())))
        })();
        if done.is_err() {
            let _ = std::fs::remove_file(&self.tmp);
        }
        done.map(|_| self.rows)
    }
}

impl Drop for ExportWriter {
    /// Not finished (cancelled, failed, panicked): remove the temp file; the target is untouched.
    fn drop(&mut self) {
        if self.out.take().is_some() {
            let _ = std::fs::remove_file(&self.tmp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("agentql-export-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(path: &Path, format: Format) -> String {
        let mut w = ExportWriter::create(path, format).unwrap();
        w.columns(&["a".into(), "b".into()]).unwrap();
        w.row(&[json!(1), json!("x,y")]).unwrap();
        w.row(&[Value::Null, json!(true)]).unwrap();
        assert_eq!(w.finish().unwrap(), 2);
        std::fs::read_to_string(path).unwrap()
    }

    /// Same bytes as the old all-in-memory `export_rows` produced.
    #[test]
    fn formats_match_the_previous_export() {
        let d = dir("formats");
        assert_eq!(
            write(&d.join("q.csv"), Format::Csv),
            "a,b\n1,\"x,y\"\n,true\n"
        );
        assert_eq!(
            write(&d.join("q.json"), Format::Json),
            "[\n  {\n    \"a\": 1,\n    \"b\": \"x,y\"\n  },\n  {\n    \"a\": null,\n    \"b\": true\n  }\n]"
        );
        assert_eq!(
            write(&d.join("orders.sql"), Format::Sql),
            "INSERT INTO \"orders\" (\"a\", \"b\") VALUES (1, 'x,y');\nINSERT INTO \"orders\" (\"a\", \"b\") VALUES (NULL, TRUE);\n"
        );
        let mut w = ExportWriter::create(&d.join("empty.json"), Format::Json).unwrap();
        w.columns(&["a".into()]).unwrap();
        w.finish().unwrap();
        assert_eq!(std::fs::read_to_string(d.join("empty.json")).unwrap(), "[]");
    }

    /// An export that never finishes leaves no file, and never touches a file that was already there.
    #[test]
    fn unfinished_export_leaves_nothing_behind() {
        let d = dir("unfinished");
        let target = d.join("keep.csv");
        std::fs::write(&target, "old contents").unwrap();
        {
            let mut w = ExportWriter::create(&target, Format::Csv).unwrap();
            w.columns(&["a".into()]).unwrap();
            w.row(&[json!(1)]).unwrap();
            // dropped without finish (cancel / error)
        }
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old contents");
        assert_eq!(
            std::fs::read_dir(&d).unwrap().count(),
            1,
            "temp file removed"
        );
        let mut w = ExportWriter::create(&target, Format::Csv).unwrap();
        w.columns(&["a".into()]).unwrap();
        w.finish().unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "a\n");
    }

    /// MySQL/MariaDB: backtick identifiers, and a string with a backslash as a hex literal, so neither a stored
    /// `\'); DROP …` value nor the import's NO_BACKSLASH_ESCAPES setting can change what is inserted. A table export
    /// names its qualified source table.
    #[test]
    fn sql_style_follows_the_source_database() {
        let d = dir("mysql");
        let path = d.join("t.sql");
        let mysql = SqlStyle {
            mysql: true,
            table: None,
        };
        let evil = "x\\'); DROP TABLE users; --";
        let mut w = ExportWriter::create(&path, Format::Sql)
            .unwrap()
            .sql_style(mysql);
        w.columns(&["a".into(), "b".into()]).unwrap();
        w.row(&[json!(evil), json!("it's")]).unwrap();
        w.finish().unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        let hex: String = evil.bytes().map(|b| format!("{b:02X}")).collect();
        assert_eq!(
            out,
            format!("INSERT INTO `t` (`a`, `b`) VALUES (_utf8mb4 X'{hex}', 'it''s');\n")
        );
        let qualified = SqlStyle {
            mysql: false,
            table: Some("\"sales\".\"orders\"".into()),
        };
        let mut w = ExportWriter::create(&path, Format::Sql)
            .unwrap()
            .sql_style(qualified);
        w.columns(&["id".into()]).unwrap();
        w.row(&[json!(1)]).unwrap();
        w.finish().unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "INSERT INTO \"sales\".\"orders\" (\"id\") VALUES (1);\n"
        );
    }

    /// Two exports to one target never share a temp file, and a planted symlink at a temp name is not followed.
    #[test]
    fn temp_files_are_unique_and_exclusive() {
        let d = dir("concurrent");
        let target = d.join("same.csv");
        let mut a = ExportWriter::create(&target, Format::Csv).unwrap();
        let mut b = ExportWriter::create(&target, Format::Csv).unwrap();
        assert_ne!(a.tmp, b.tmp);
        a.columns(&["a".into()]).unwrap();
        b.columns(&["b".into()]).unwrap();
        drop(b); // cancelled: must not touch a's temp file
        a.finish().unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "a\n");
        #[cfg(unix)]
        {
            let victim = d.join("victim");
            std::fs::write(&victim, "keep").unwrap();
            let w = ExportWriter::create(&target, Format::Csv).unwrap();
            let tmp = w.tmp.clone();
            drop(w);
            std::os::unix::fs::symlink(&victim, &tmp).unwrap();
            // create_new refuses an existing path, symlink included, so the victim is never truncated.
            let r = OpenOptions::new().write(true).create_new(true).open(&tmp);
            assert!(r.is_err());
            assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep");
        }
    }
}
