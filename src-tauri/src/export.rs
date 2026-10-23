//! Streaming export: CSV / JSON / SQL INSERTs written row by row. Output goes to a temp file next to the target and
//! is renamed over it only by `finish`, so a cancelled or failed export leaves no half-written file and never
//! replaces a file that was already there.

use crate::db::sql::SqlConn;
use crate::error::{AppError, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Rows per channel message; with a channel of `QUEUE` messages, at most `BATCH_ROWS * QUEUE` rows are in memory.
pub const BATCH_ROWS: usize = 500;
const QUEUE: usize = 4;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// What the database side hands the writer thread.
pub enum Batch {
    Columns(Vec<String>),
    Rows(Vec<Vec<Value>>),
}

/// Running exports by id; `cancel` sets the flag, the reader stops at the next row.
static JOBS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(Default::default);

fn jobs() -> std::sync::MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ask a running export to stop. False when no export has that id (already done).
pub fn cancel(id: &str) -> bool {
    jobs()
        .get(id)
        .map(|f| f.store(true, Ordering::Relaxed))
        .is_some()
}

struct JobGuard(String);
impl Drop for JobGuard {
    fn drop(&mut self) {
        jobs().remove(&self.0);
    }
}

fn blocking_err(e: impl std::fmt::Display) -> AppError {
    AppError::Msg(e.to_string())
}

/// Export every row of a read-only statement to `path`. Rows stream from the database through a bounded channel to
/// a writer thread, which reports the rows written so far to `progress` (at most every 250 ms). The file only
/// replaces `path` when the read finished without error or cancel.
pub async fn export_query(
    conn: &SqlConn,
    id: String,
    sql: &str,
    path: PathBuf,
    format: Format,
    progress: impl Fn(usize) + Send + 'static,
) -> Result<usize> {
    let stop = Arc::new(AtomicBool::new(false));
    jobs().insert(id.clone(), stop.clone());
    let _guard = JobGuard(id.clone());
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Batch>(QUEUE);
    let writer = tauri::async_runtime::spawn_blocking(move || -> Result<ExportWriter> {
        let mut w = ExportWriter::create(&path, format)?;
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
    let read = conn.stream_read_only(sql, &tx, &stop).await;
    drop(tx);
    // A writer error (disk full, permission) wins: the reader only saw its channel close.
    let w = writer.await.map_err(blocking_err)??;
    let cancelled = stop.load(Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || match (read, cancelled) {
        (Err(e), _) => Err(e),
        (Ok(_), true) => Err(AppError::Msg("Export cancelled".into())),
        (Ok(_), false) => w.finish(),
    })
    .await
    .map_err(blocking_err)?
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Csv,
    Json,
    Sql,
}

impl Format {
    pub fn parse(s: &str) -> Format {
        match s {
            "json" => Format::Json,
            "sql" => Format::Sql,
            _ => Format::Csv,
        }
    }
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
    rows: usize,
}

fn cell(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        o => o.to_string(),
    }
}

fn csv_err(e: csv::Error) -> AppError {
    AppError::Msg(e.to_string())
}

impl ExportWriter {
    pub fn create(target: &Path, format: Format) -> Result<ExportWriter> {
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "export".into());
        let tmp = target.with_file_name(format!(".{name}.agentql-part"));
        let file = File::create(&tmp)?;
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
            rows: 0,
        })
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    /// Set the column names; call once, before the first row.
    pub fn columns(&mut self, columns: &[String]) -> Result<()> {
        self.columns = columns.to_vec();
        match self.out.as_mut() {
            Some(Out::Csv(w)) => w.write_record(columns).map_err(csv_err),
            _ => Ok(()),
        }
    }

    pub fn row(&mut self, row: &[Value]) -> Result<()> {
        let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
        match self.out.as_mut() {
            Some(Out::Csv(w)) => w.write_record(row.iter().map(cell)).map_err(csv_err)?,
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
                        o => format!("'{}'", cell(o).replace('\'', "''")),
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
            match out {
                Some(Out::Csv(w)) => {
                    let file = w.into_inner().map_err(|e| AppError::Msg(e.to_string()))?;
                    file.sync_all()?;
                }
                Some(Out::Plain(mut w)) => {
                    if self.format == Format::Json {
                        w.write_all(if self.rows == 0 { b"]" } else { b"\n]" })?;
                    }
                    let file = w.into_inner().map_err(|e| AppError::Msg(e.to_string()))?;
                    file.sync_all()?;
                }
                None => return Err(AppError::Msg("export already finished".into())),
            }
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

    fn write(path: &Path, format: &str) -> String {
        let mut w = ExportWriter::create(path, Format::parse(format)).unwrap();
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
        assert_eq!(write(&d.join("q.csv"), "csv"), "a,b\n1,\"x,y\"\n,true\n");
        assert_eq!(
            write(&d.join("q.json"), "json"),
            "[\n  {\n    \"a\": 1,\n    \"b\": \"x,y\"\n  },\n  {\n    \"a\": null,\n    \"b\": true\n  }\n]"
        );
        assert_eq!(
            write(&d.join("orders.sql"), "sql"),
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
}
