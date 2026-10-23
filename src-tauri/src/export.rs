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
/// replaces `path` when the read finished without error or cancel. `backslash_escapes`: SQL output for MySQL/MariaDB.
/// ponytail: a re-run is a fresh session; volatile functions and session state (SET search_path) can differ from the
/// grid's run, and a long export holds one read-only transaction open.
pub async fn export_query(
    conn: &SqlConn,
    job: Job,
    sql: &str,
    path: PathBuf,
    format: Format,
    backslash_escapes: bool,
    progress: impl Fn(usize) + Send + 'static,
) -> Result<usize> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Batch>(QUEUE);
    let writer = blocking(move || {
        let mut w = ExportWriter::create(&path, format)?.backslash_escapes(backslash_escapes);
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
    /// SQL format: also double backslashes in string literals (MySQL/MariaDB read `\'` as an escaped quote).
    backslash_escapes: bool,
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
            backslash_escapes: false,
            rows: 0,
        })
    }

    pub fn backslash_escapes(mut self, on: bool) -> Self {
        self.backslash_escapes = on;
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
        let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
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
                            let mut text = cell(o);
                            if self.backslash_escapes {
                                text = text.replace('\\', "\\\\");
                            }
                            format!("'{}'", text.replace('\'', "''"))
                        }
                    })
                    .collect();
                writeln!(
                    w,
                    "INSERT INTO {} ({}) VALUES ({});",
                    q(&self.table),
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

    /// MySQL/MariaDB treat `\'` as an escaped quote: without doubling the backslash, a stored `\'); DROP …` value
    /// would close the literal when the file is imported.
    #[test]
    fn sql_backslashes_are_doubled_for_mysql() {
        let d = dir("mysql");
        let path = d.join("t.sql");
        let mut w = ExportWriter::create(&path, Format::Sql)
            .unwrap()
            .backslash_escapes(true);
        w.columns(&["a".into()]).unwrap();
        w.row(&[json!("x\\'); DROP TABLE users; --")]).unwrap();
        w.finish().unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "INSERT INTO \"t\" (\"a\") VALUES ('x\\\\''); DROP TABLE users; --');\n"
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
