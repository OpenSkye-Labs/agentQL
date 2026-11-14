//! SQL commands: queries, table browsing and editing, export, schema.

use super::*;

// ----------------------------------------------------------------- sql

#[tauri::command]
pub async fn run_query(
    st: State<'_, AppState>,
    id: String,
    sql_text: String,
    limit: Option<u32>,
) -> Result<Vec<QueryResult>> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    if s.config.read_only && !crate::db::sql::is_read_only(s.config.driver, &sql_text) {
        return Err(AppError::Msg("This connection is marked read-only. Disable it in the connection settings to run write statements.".into()));
    }
    let limit = limit.unwrap_or_else(|| st.store.settings().row_limit);
    if s.config.read_only {
        return c.run_read_only(&sql_text, limit).await;
    }
    c.run(&sql_text, limit).await
}

/// Write statements in `sql_text` (kind + target table) for the production confirmation prompt.
#[tauri::command]
pub fn classify_sql(
    driver: crate::config::Driver,
    sql_text: String,
) -> Vec<crate::db::sql::WriteInfo> {
    crate::db::sql::classify_writes(driver, &sql_text)
}

#[tauri::command]
pub async fn explain_query(
    st: State<'_, AppState>,
    id: String,
    sql_text: String,
    analyze: bool,
) -> Result<QueryResult> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    if analyze && !crate::db::sql::is_read_only(s.config.driver, &sql_text) {
        return Err(AppError::Msg(
            "EXPLAIN ANALYZE executes the statement; refusing to analyze a write.".into(),
        ));
    }
    let stmt = crate::db::sql::split_statements(&sql_text)
        .into_iter()
        .next()
        .unwrap_or_default();
    c.run_one_read_only(&c.explain_sql(&stmt, analyze), 10_000)
        .await
}

#[tauri::command]
pub async fn list_databases(st: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    match &s.live {
        Live::Sql(c) => c.databases().await,
        Live::Mongo(m) => m.databases().await,
        Live::Redis(_) => Ok((0..16).map(|i| i.to_string()).collect()),
    }
}

#[tauri::command]
pub async fn list_schemas(st: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.schemas().await
}

#[tauri::command]
pub async fn list_tables(
    st: State<'_, AppState>,
    id: String,
    schema: String,
) -> Result<Vec<TableInfo>> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.tables(&schema).await
}

#[tauri::command]
pub async fn table_details(
    st: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
) -> Result<TableDetails> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.table_details(&schema, &table).await
}

#[tauri::command]
pub async fn schema_objects(
    st: State<'_, AppState>,
    id: String,
    schema: String,
) -> Result<Vec<SchemaObject>> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.schema_objects(&schema).await
}

/// Write base64-encoded bytes to a path the user picked in a save dialog (SVG/PNG exports).
/// The dialog runs in the webview, so the path is re-checked here: absolute and an export extension only.
#[tauri::command]
pub async fn save_file(path: String, data: String) -> Result<()> {
    use base64::Engine as _;
    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !p.is_absolute() || !matches!(ext.as_deref(), Some("svg" | "png")) {
        return Err(AppError::Msg(
            "export path must be an absolute .svg or .png file".into(),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| AppError::Msg(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

#[derive(Serialize)]
pub struct TablePage {
    pub result: QueryResult,
    pub total: Option<i64>,
    pub sql_text: String,
}

#[tauri::command]
pub async fn fetch_table(
    st: State<'_, AppState>,
    id: String,
    query: TableQuery,
) -> Result<TablePage> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    c.validate_filter(query.filter.as_deref())?;
    let sql_text = c.select_sql(&query);
    let result = c.run_one_read_only(&sql_text, query.limit.max(1)).await?;
    // The exact count is fetched separately (`count_table`) so big tables render immediately.
    Ok(TablePage {
        result,
        total: None,
        sql_text,
    })
}

#[tauri::command]
pub async fn count_table(st: State<'_, AppState>, id: String, query: TableQuery) -> Result<i64> {
    let s = st.manager.get(&id).await?;
    let c = sql(&s).await?;
    c.validate_filter(query.filter.as_deref())?;
    c.count(&query).await
}

#[tauri::command]
pub async fn preview_changes(
    st: State<'_, AppState>,
    id: String,
    schema: Option<String>,
    table: String,
    changes: Vec<RowChange>,
    types: Option<std::collections::HashMap<String, String>>,
) -> Result<Vec<String>> {
    let s = st.manager.get(&id).await?;
    Ok(sql(&s).await?.change_sql(
        schema.as_deref(),
        &table,
        &changes,
        &types.unwrap_or_default(),
    ))
}

#[tauri::command]
pub async fn apply_changes(
    st: State<'_, AppState>,
    id: String,
    schema: Option<String>,
    table: String,
    changes: Vec<RowChange>,
    types: Option<std::collections::HashMap<String, String>>,
) -> Result<u64> {
    let s = st.manager.get(&id).await?;
    if s.config.read_only {
        return Err(AppError::Msg("connection is read-only".into()));
    }
    let c = sql(&s).await?;
    let stmts = c.change_sql(
        schema.as_deref(),
        &table,
        &changes,
        &types.unwrap_or_default(),
    );
    c.execute_batch(&stmts).await
}

#[tauri::command]
pub fn ssh_forget_host(st: State<'_, AppState>, host: String, port: u16) -> Result<()> {
    crate::ssh::forget_host(&st.manager.known_hosts_path, &host, port)
}

fn is_mysql(driver: Option<crate::config::Driver>) -> bool {
    matches!(
        driver,
        Some(crate::config::Driver::Mysql | crate::config::Driver::Mariadb)
    )
}

/// Write rows the UI already holds (a result whose statement must not be re-run).
#[tauri::command]
pub async fn export_rows(
    path: String,
    format: crate::export::Format,
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    driver: Option<crate::config::Driver>,
) -> Result<usize> {
    blocking(move || {
        let mut w = crate::export::ExportWriter::create(path.as_ref(), format)?.sql_style(
            crate::export::SqlStyle {
                mysql: is_mysql(driver),
                table: None,
            },
        );
        w.columns(&columns)?;
        for r in &rows {
            w.row(r)?;
        }
        w.finish()
    })
    .await
}

async fn run_export(
    app: AppHandle,
    c: &crate::db::sql::SqlConn,
    job: crate::export::Job,
    sql_text: &str,
    path: String,
    format: crate::export::Format,
    sql_style: crate::export::SqlStyle,
) -> Result<usize> {
    let id = job.id().to_string();
    crate::export::export_query(
        c,
        job,
        sql_text,
        path.into(),
        format,
        sql_style,
        move |rows| {
            let _ = app.emit("export:progress", json!({ "id": id, "rows": rows }));
        },
    )
    .await
}

/// Re-run a read-only statement and stream every row to `path` (progress on `export:progress`, stop with
/// `export_cancel`). Anything that is not read-only is refused: re-running it would repeat its side effects.
#[tauri::command]
pub async fn export_query(
    app: AppHandle,
    st: State<'_, AppState>,
    id: String,
    connection_id: String,
    sql_text: String,
    path: String,
    format: crate::export::Format,
) -> Result<usize> {
    // Registered first, so a Cancel during the lookups below is not lost.
    let job = crate::export::Job::start(id);
    let s = st.manager.get(&connection_id).await?;
    let c = sql(&s).await?;
    if !crate::db::sql::is_read_only(s.config.driver, &sql_text) {
        return Err(AppError::Msg(
            "Only read-only statements can be re-run for a full export.".into(),
        ));
    }
    let style = crate::export::SqlStyle {
        mysql: is_mysql(Some(s.config.driver)),
        table: None,
    };
    run_export(app, c, job, &sql_text, path, format, style).await
}

/// Every row of a table, with the grid's filter and sort.
#[tauri::command]
pub async fn export_table(
    app: AppHandle,
    st: State<'_, AppState>,
    id: String,
    connection_id: String,
    query: TableQuery,
    path: String,
    format: crate::export::Format,
) -> Result<usize> {
    let job = crate::export::Job::start(id);
    let s = st.manager.get(&connection_id).await?;
    let c = sql(&s).await?;
    c.validate_filter(query.filter.as_deref())?;
    let sql_text = c.select_all_sql(&query);
    // The SQL file inserts back into the same (schema-qualified) table it came from.
    let style = crate::export::SqlStyle {
        mysql: is_mysql(Some(s.config.driver)),
        table: Some(c.qualified(query.schema.as_deref(), &query.table)),
    };
    run_export(app, c, job, &sql_text, path, format, style).await
}

#[tauri::command]
pub fn export_cancel(id: String) -> Result<bool> {
    Ok(crate::export::cancel(&id))
}

/// Read a text file the user picked in a dialog (.sql, profile JSON). Capped so a stray
/// multi-GB pick cannot stall the webview.
// ponytail: like `export_rows`, the path is whatever the (first-party) webview sends; gate it on a
// backend-held set of dialog-returned paths or tauri-plugin-fs scopes if the webview ever renders
// third-party HTML.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String> {
    blocking(move || {
        const MAX: u64 = 20 * 1024 * 1024;
        let len = std::fs::metadata(&path)?.len();
        if len > MAX {
            return Err(AppError::Msg(format!(
                "file is {} MB; the editor opens files up to 20 MB",
                len / (1024 * 1024)
            )));
        }
        let text = String::from_utf8(std::fs::read(&path)?).map_err(|_| {
            AppError::Msg("file is not UTF-8 text (UTF-16 files are not supported)".into())
        })?;
        // Editors on Windows often write a BOM; it is invisible in the editor and breaks the first statement.
        Ok(text.trim_start_matches('\u{feff}').to_string())
    })
    .await
}

/// Writes next to the target and renames, so a failed save leaves the previous file intact.
// ponytail: a dangling symlink is replaced by a regular file; resolve `read_link` chains if that matters.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<()> {
    blocking(move || {
        // Follow a symlink so the target gets the text and the link survives.
        let dest = std::fs::canonicalize(&path).unwrap_or_else(|_| std::path::PathBuf::from(&path));
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let name = dest
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default();
        let tmp = dest.with_file_name(format!(".{name}.{}.{nonce}.tmp", std::process::id()));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            let mut f = opts.open(&tmp)?;
            f.write_all(contents.as_bytes())?;
            f.sync_all()?;
            // Keep the destination's mode instead of the private temp mode.
            if let Ok(meta) = std::fs::metadata(&dest) {
                std::fs::set_permissions(&tmp, meta.permissions())?;
            }
            std::fs::rename(&tmp, &dest)
        };
        write().map_err(|e| {
            std::fs::remove_file(&tmp).ok();
            AppError::Msg(format!("saving {}: {e}", dest.display()))
        })
    })
    .await
}

#[tauri::command]
pub async fn schema_catalog(
    st: State<'_, AppState>,
    id: String,
    schema: String,
) -> Result<SchemaCatalog> {
    let s = st.manager.get(&id).await?;
    sql(&s).await?.schema_catalog(&schema).await
}
