//! Bench mode for docs/PERFORMANCE.md. `AGENTQL_BENCH=<marks.json>` runs the app on a throwaway data dir; the UI
//! (src/lib/bench.ts) reports marks here and each one rewrites `<marks.json>` so scripts/perf/bench-app.mjs can
//! follow along and sample memory. The app exits on the "done" mark. The data dir is `<marks>.data` next to the marks
//! file; the runner deletes it after the app exits (SQLite still holds the fixture open until then on Windows).

use serde_json::{Map, Value, json};
use std::{path::PathBuf, sync::Mutex, time::Instant};

pub struct Bench {
    pub dir: PathBuf,
    out: PathBuf,
    t0: Instant,
    marks: Mutex<Map<String, Value>>,
}

impl Bench {
    /// `t0` is taken at the top of `run()`, so cold start excludes the loader's few ms before main.
    pub fn from_env(t0: Instant) -> Option<Self> {
        let out = PathBuf::from(std::env::var_os("AGENTQL_BENCH")?);
        let dir = out.with_extension("data");
        Some(Bench {
            dir,
            out,
            t0,
            marks: Mutex::new(Map::new()),
        })
    }

    /// Records `ms`, or the time since start when absent, and rewrites the marks file. Returns whether to exit.
    pub fn mark(&self, name: String, ms: Option<f64>) -> std::io::Result<bool> {
        let ms = ms.unwrap_or_else(|| self.t0.elapsed().as_secs_f64() * 1000.0);
        let done = name == "done";
        let body = {
            let mut marks = self.marks.lock().unwrap();
            marks.insert(name, json!((ms * 10.0).round() / 10.0));
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "pid": std::process::id(),
                "marks": *marks,
            })
        };
        let tmp = self.out.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&body)?)?;
        std::fs::rename(&tmp, &self.out)?;
        Ok(done)
    }
}

/// Records a bench mark; returns the bench data dir, or None outside bench mode.
#[tauri::command]
pub fn bench_mark(
    app: tauri::AppHandle,
    name: String,
    ms: Option<f64>,
) -> crate::error::Result<Option<String>> {
    use tauri::Manager as _;
    let Some(bench) = app.try_state::<Bench>() else {
        return Ok(None);
    };
    if bench.mark(name, ms)? {
        app.exit(0);
    }
    Ok(Some(bench.dir.to_string_lossy().into_owned()))
}
