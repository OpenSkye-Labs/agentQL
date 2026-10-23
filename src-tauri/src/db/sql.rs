//! SQL drivers (PostgreSQL, MySQL/MariaDB, SQLite) on top of sqlx, with
//! dynamic result decoding, schema introspection and table editing helpers.

use super::value::{mysql_value, pg_value, sqlite_value};
use super::{
    CatalogColumn, CatalogForeignKey, Column, ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult,
    RowChange, SchemaCatalog, SchemaObject, TableDetails, TableInfo, TableQuery,
};
use crate::config::{ConnectionConfig, ConnectionSecrets, Driver};
use crate::error::{AppError, Result};
use futures::StreamExt;
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::{Column as _, ConnectOptions, Either, Executor, Row, TypeInfo};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};

pub enum Pool {
    Pg(PgPool),
    My(MySqlPool),
    Lite(SqlitePool),
}

pub struct SqlConn {
    pub driver: Driver,
    pub pool: Pool,
}

// ---------------------------------------------------------------- connect

/// `localhost` resolves to `::1` first on Windows, and Docker Desktop (and most local servers) only answer on
/// `127.0.0.1`; the IPv6 attempt then sits in the OS connect timeout longer than our pool timeout, so the UI
/// looked stuck on "connecting". Prefer the IPv4 address when the name resolves to one.
/// Skipped under `verify-full`, where TLS must verify the certificate against the hostname.
/// ponytail: only `localhost` is rewritten, and an IPv6-only local server would need the IPv6 fallback
/// (retry with the original name on refusal) if anyone hits it.
fn connect_host(host: &str, port: u16, ssl_mode: Option<&str>) -> String {
    use std::net::ToSocketAddrs as _;
    if !host.eq_ignore_ascii_case("localhost") || ssl_mode == Some("verify-full") {
        return host.to_string();
    }
    (host, port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.find(|a| a.is_ipv4()))
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| host.to_string())
}

#[cfg(test)]
mod connect_host_tests {
    use super::connect_host;

    #[test]
    fn localhost_prefers_ipv4_and_other_hosts_are_untouched() {
        assert_eq!(
            connect_host("localhost", 5432, Some("disable")),
            "127.0.0.1"
        );
        assert_eq!(connect_host("LOCALHOST", 5432, None), "127.0.0.1");
        assert_eq!(
            connect_host("localhost", 5432, Some("verify-full")),
            "localhost"
        );
        assert_eq!(connect_host("db.internal", 5432, None), "db.internal");
        assert_eq!(connect_host("127.0.0.1", 5432, None), "127.0.0.1");
        assert_eq!(connect_host("::1", 5432, None), "::1");
    }
}

impl SqlConn {
    pub async fn connect(c: &ConnectionConfig, s: &ConnectionSecrets) -> Result<SqlConn> {
        let pool = match c.driver {
            Driver::Postgres => {
                let mut o = match &c.url {
                    Some(url) => PgConnectOptions::from_str(url)
                        .map_err(|e| AppError::Msg(format!("invalid url: {e}")))?,
                    None => PgConnectOptions::new()
                        .host(&connect_host(
                            &c.host,
                            if c.port == 0 { 5432 } else { c.port },
                            c.ssl_mode.as_deref(),
                        ))
                        .port(if c.port == 0 { 5432 } else { c.port })
                        .username(&c.user)
                        .database(if c.database.is_empty() {
                            "postgres"
                        } else {
                            &c.database
                        }),
                };
                if let Some(pw) = &s.password
                    && !pw.is_empty()
                {
                    o = o.password(pw);
                }
                if let Some(mode) = &c.ssl_mode {
                    o = o.ssl_mode(match mode.as_str() {
                        "disable" => PgSslMode::Disable,
                        "allow" => PgSslMode::Allow,
                        "require" => PgSslMode::Require,
                        "verify-ca" => PgSslMode::VerifyCa,
                        "verify-full" => PgSslMode::VerifyFull,
                        _ => PgSslMode::Prefer,
                    });
                }
                if let Some(p) = c.ssl_ca_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_root_cert(p);
                }
                if let Some(p) = c.ssl_cert_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_client_cert(p);
                }
                if let Some(p) = c.ssl_key_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_client_key(p);
                }
                o = o
                    .application_name("AgentQL")
                    .log_statements(log::LevelFilter::Off);
                for (k, v) in &c.options {
                    o = o.options([(k.as_str(), v.as_str())]);
                }
                Pool::Pg(
                    sqlx::pool::PoolOptions::new()
                        .max_connections(5)
                        .acquire_timeout(Duration::from_secs(15))
                        .connect_with(o)
                        .await?,
                )
            }
            Driver::Mysql | Driver::Mariadb => {
                let mut o = match &c.url {
                    Some(url) => MySqlConnectOptions::from_str(url)
                        .map_err(|e| AppError::Msg(format!("invalid url: {e}")))?,
                    None => {
                        let mut o = MySqlConnectOptions::new()
                            .host(&connect_host(
                                &c.host,
                                if c.port == 0 { 3306 } else { c.port },
                                c.ssl_mode.as_deref(),
                            ))
                            .port(if c.port == 0 { 3306 } else { c.port })
                            .username(&c.user);
                        if !c.database.is_empty() {
                            o = o.database(&c.database);
                        }
                        o
                    }
                };
                if let Some(pw) = &s.password
                    && !pw.is_empty()
                {
                    o = o.password(pw);
                }
                if let Some(mode) = &c.ssl_mode {
                    o = o.ssl_mode(match mode.as_str() {
                        "disable" => MySqlSslMode::Disabled,
                        "require" => MySqlSslMode::Required,
                        "verify-ca" => MySqlSslMode::VerifyCa,
                        "verify-full" => MySqlSslMode::VerifyIdentity,
                        _ => MySqlSslMode::Preferred,
                    });
                }
                if let Some(p) = c.ssl_ca_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_ca(p);
                }
                if let Some(p) = c.ssl_cert_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_client_cert(p);
                }
                if let Some(p) = c.ssl_key_path.as_deref().filter(|p| !p.is_empty()) {
                    o = o.ssl_client_key(p);
                }
                o = o.log_statements(log::LevelFilter::Off);
                Pool::My(
                    sqlx::pool::PoolOptions::new()
                        .max_connections(5)
                        .acquire_timeout(Duration::from_secs(15))
                        .connect_with(o)
                        .await?,
                )
            }
            Driver::Sqlite => {
                let path = c
                    .file_path
                    .clone()
                    .or_else(|| c.url.clone())
                    .ok_or_else(|| AppError::Msg("sqlite file path required".into()))?;
                let o = SqliteConnectOptions::from_str(&path)
                    .map_err(|e| AppError::Msg(format!("invalid sqlite path: {e}")))?
                    .create_if_missing(true)
                    .foreign_keys(true)
                    .log_statements(log::LevelFilter::Off);
                Pool::Lite(
                    sqlx::pool::PoolOptions::new()
                        .max_connections(1)
                        .connect_with(o)
                        .await?,
                )
            }
            _ => return Err(AppError::Msg("not a sql driver".into())),
        };
        Ok(SqlConn {
            driver: c.driver,
            pool,
        })
    }

    pub async fn close(&self) {
        match &self.pool {
            Pool::Pg(p) => p.close().await,
            Pool::My(p) => p.close().await,
            Pool::Lite(p) => p.close().await,
        }
    }

    // ---------------------------------------------------------------- execution

    /// Execute one or more statements; one result per statement.
    pub async fn run(&self, sql: &str, limit: u32) -> Result<Vec<QueryResult>> {
        let mut out = vec![];
        for stmt in split_statements(sql) {
            out.push(self.run_one(&stmt, limit).await?);
        }
        Ok(out)
    }

    pub async fn run_one(&self, sql: &str, limit: u32) -> Result<QueryResult> {
        self.run_one_opts(sql, limit, false, None).await
    }

    /// Execute a single statement inside a database-enforced read-only context
    /// (READ ONLY transaction / `PRAGMA query_only`), so even `SELECT nextval()`
    /// or stray semicolons cannot write.
    pub async fn run_one_read_only(&self, sql: &str, limit: u32) -> Result<QueryResult> {
        self.run_one_opts(sql, limit, true, None).await
    }

    pub async fn run_read_only(&self, sql: &str, limit: u32) -> Result<Vec<QueryResult>> {
        self.run_with_search_path(sql, limit, true, None).await
    }

    /// `run` / `run_read_only` with the Postgres `search_path` pinned for the duration of each
    /// statement (`SET LOCAL` inside the transaction), so unqualified names resolve to the schema
    /// the agent scope check used, whatever the pooled session's `search_path` was changed to.
    /// Ignored on other drivers: their scoped callers require schema-qualified names instead.
    pub async fn run_with_search_path(
        &self,
        sql: &str,
        limit: u32,
        read_only: bool,
        search_path: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let mut out = vec![];
        for stmt in split_statements(sql) {
            out.push(
                self.run_one_opts(&stmt, limit, read_only, search_path)
                    .await?,
            );
        }
        Ok(out)
    }

    async fn run_one_opts(
        &self,
        sql: &str,
        limit: u32,
        read_only: bool,
        search_path: Option<&str>,
    ) -> Result<QueryResult> {
        let start = Instant::now();
        let mut res = match (&self.pool, read_only, search_path) {
            (Pool::Pg(p), false, None) => exec_stream!(p, sql, limit, pg_value)?,
            (Pool::My(p), false, _) => exec_stream!(p, sql, limit, mysql_value)?,
            (Pool::Lite(p), false, _) => exec_stream!(p, sql, limit, sqlite_value)?,
            (Pool::Pg(p), _, _) => {
                let mut tx = p.begin().await?;
                if read_only {
                    sqlx::query("SET TRANSACTION READ ONLY")
                        .execute(&mut *tx)
                        .await?;
                }
                if let Some(schema) = search_path {
                    sqlx::query(&format!(
                        "SET LOCAL search_path TO {}",
                        self.quote_ident(schema)
                    ))
                    .execute(&mut *tx)
                    .await?;
                }
                let r = exec_stream!(&mut *tx, sql, limit, pg_value);
                match (&r, read_only) {
                    (Ok(_), false) => tx.commit().await?,
                    _ => {
                        let _ = tx.rollback().await;
                    }
                }
                r?
            }
            (Pool::My(p), true, _) => {
                // START TRANSACTION is not preparable on MySQL; SET TRANSACTION (next txn only) + begin() is.
                let mut conn = p.acquire().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *conn)
                    .await?;
                let mut tx = sqlx::Connection::begin(&mut *conn).await?;
                let r = exec_stream!(&mut *tx, sql, limit, mysql_value);
                let _ = tx.rollback().await;
                r?
            }
            (Pool::Lite(p), true, _) => {
                let mut conn = p.acquire().await?;
                sqlx::query("PRAGMA query_only = 1")
                    .execute(&mut *conn)
                    .await?;
                let r = exec_stream!(&mut *conn, sql, limit, sqlite_value);
                let _ = sqlx::query("PRAGMA query_only = 0")
                    .execute(&mut *conn)
                    .await;
                r?
            }
        };
        if res.columns.is_empty() && res.rows.is_empty() && is_query_like(sql) {
            // Zero-row SELECT: still show the headers.
            res.columns = self
                .describe_columns(sql, search_path)
                .await
                .unwrap_or_default();
        }
        res.duration_ms = start.elapsed().as_millis();
        res.statement = sql.to_string();
        Ok(res)
    }

    /// Column metadata for a statement; `search_path` pins the Postgres schema the same way
    /// `run_one_opts` did, so the headers describe the query that actually ran.
    /// Stream a read-only statement's rows to `tx` in batches without collecting them (export). Same enforcement as
    /// `run_read_only`: a read-only transaction on Postgres/MySQL, `query_only` on SQLite. Stops early when `stop`
    /// is set or the receiver is gone. Returns the number of rows sent.
    pub async fn stream_read_only(
        &self,
        sql: &str,
        tx: &tokio::sync::mpsc::Sender<crate::export::Batch>,
        stop: &std::sync::atomic::AtomicBool,
    ) -> Result<u64> {
        let sent = match &self.pool {
            Pool::Pg(p) => {
                let mut t = p.begin().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *t)
                    .await?;
                let r = stream_batches!(&mut *t, sql, pg_value, tx, stop);
                let _ = t.rollback().await;
                r?
            }
            Pool::My(p) => {
                // START TRANSACTION is not preparable on MySQL; SET TRANSACTION (next txn only) + begin() is.
                let mut conn = p.acquire().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *conn)
                    .await?;
                let mut t = sqlx::Connection::begin(&mut *conn).await?;
                let r = stream_batches!(&mut *t, sql, mysql_value, tx, stop);
                let _ = t.rollback().await;
                r?
            }
            Pool::Lite(p) => {
                let mut conn = p.acquire().await?;
                sqlx::query("PRAGMA query_only = 1")
                    .execute(&mut *conn)
                    .await?;
                let r = stream_batches!(&mut *conn, sql, sqlite_value, tx, stop);
                let _ = sqlx::query("PRAGMA query_only = 0")
                    .execute(&mut *conn)
                    .await;
                r?
            }
        };
        if sent == 0 {
            // Zero rows: still write the header.
            let cols = self.describe_columns(sql, None).await.unwrap_or_default();
            let _ = tx
                .send(crate::export::Batch::Columns(
                    cols.into_iter().map(|c| c.name).collect(),
                ))
                .await;
        }
        Ok(sent)
    }

    async fn describe_columns(&self, sql: &str, search_path: Option<&str>) -> Result<Vec<Column>> {
        let to_columns = |cols: &[sqlx::postgres::PgColumn]| -> Vec<Column> {
            cols.iter()
                .map(|c| Column {
                    name: c.name().to_string(),
                    type_name: c.type_info().name().to_string(),
                })
                .collect()
        };
        Ok(match (&self.pool, search_path) {
            (Pool::Pg(p), Some(schema)) => {
                let mut tx = p.begin().await?;
                sqlx::query(&format!(
                    "SET LOCAL search_path TO {}",
                    self.quote_ident(schema)
                ))
                .execute(&mut *tx)
                .await?;
                let d = (&mut *tx).describe(sql).await;
                let _ = tx.rollback().await;
                to_columns(d?.columns())
            }
            (Pool::Pg(p), None) => to_columns(p.describe(sql).await?.columns()),
            (Pool::My(p), _) => p
                .describe(sql)
                .await?
                .columns()
                .iter()
                .map(|c| Column {
                    name: c.name().to_string(),
                    type_name: c.type_info().name().to_string(),
                })
                .collect(),
            (Pool::Lite(p), _) => p
                .describe(sql)
                .await?
                .columns()
                .iter()
                .map(|c| Column {
                    name: c.name().to_string(),
                    type_name: c.type_info().name().to_string(),
                })
                .collect(),
        })
    }

    /// Run a statement and get rows as JSON objects (introspection helper).
    async fn rows(&self, sql: &str) -> Result<Vec<HashMap<String, Value>>> {
        let r = self.run_one(sql, 100_000).await?;
        Ok(r.rows
            .into_iter()
            .map(|row| {
                r.columns
                    .iter()
                    .zip(row)
                    .map(|(c, v)| (c.name.clone(), v))
                    .collect()
            })
            .collect())
    }

    pub async fn execute_batch(&self, statements: &[String]) -> Result<u64> {
        let mut affected = 0;
        match &self.pool {
            Pool::Pg(p) => {
                let mut tx = p.begin().await?;
                for s in statements {
                    affected += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
            }
            Pool::My(p) => {
                let mut tx = p.begin().await?;
                for s in statements {
                    affected += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
            }
            Pool::Lite(p) => {
                let mut tx = p.begin().await?;
                for s in statements {
                    affected += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
            }
        }
        Ok(affected)
    }

    pub fn explain_sql(&self, sql: &str, analyze: bool) -> String {
        match self.driver {
            Driver::Postgres => {
                if analyze {
                    format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) {sql}")
                } else {
                    format!("EXPLAIN (FORMAT TEXT) {sql}")
                }
            }
            Driver::Mysql | Driver::Mariadb => {
                if analyze {
                    format!("EXPLAIN ANALYZE {sql}")
                } else {
                    format!("EXPLAIN {sql}")
                }
            }
            _ => format!("EXPLAIN QUERY PLAN {sql}"),
        }
    }

    // ---------------------------------------------------------------- quoting

    pub fn quote_ident(&self, s: &str) -> String {
        match self.driver {
            Driver::Mysql | Driver::Mariadb => format!("`{}`", s.replace('`', "``")),
            _ => format!("\"{}\"", s.replace('"', "\"\"")),
        }
    }

    pub fn qualified(&self, schema: Option<&str>, table: &str) -> String {
        match schema {
            Some(s) if !s.is_empty() && self.driver != Driver::Sqlite => {
                format!("{}.{}", self.quote_ident(s), self.quote_ident(table))
            }
            Some(s) if !s.is_empty() && s != "main" => {
                format!("{}.{}", self.quote_ident(s), self.quote_ident(table))
            }
            _ => self.quote_ident(table),
        }
    }

    pub fn literal(&self, v: &Value) -> String {
        self.literal_typed(v, None)
    }

    /// `type_hint` is the column's declared type when known (drives json vs array vs bytes encoding).
    pub fn literal_typed(&self, v: &Value, type_hint: Option<&str>) -> String {
        let hint = type_hint.map(|t| t.to_lowercase()).unwrap_or_default();
        if let Some(b64) = v.get("$bytes").and_then(|b| b.as_str()) {
            let safe: String = b64
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=')
                .collect();
            return match self.driver {
                Driver::Postgres => format!("decode('{safe}', 'base64')"),
                Driver::Mysql | Driver::Mariadb => format!("FROM_BASE64('{safe}')"),
                _ => {
                    use base64::Engine;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(&safe)
                        .unwrap_or_default();
                    format!(
                        "X'{}'",
                        bytes.iter().map(|b| format!("{b:02X}")).collect::<String>()
                    )
                }
            };
        }
        match v {
            Value::Null => "NULL".into(),
            Value::Bool(b) => {
                if matches!(
                    self.driver,
                    Driver::Mysql | Driver::Mariadb | Driver::Sqlite
                ) {
                    if *b { "1".into() } else { "0".into() }
                } else if *b {
                    "TRUE".into()
                } else {
                    "FALSE".into()
                }
            }
            Value::Number(n) => n.to_string(),
            Value::String(s) => {
                let esc = s.replace('\'', "''");
                if matches!(self.driver, Driver::Mysql | Driver::Mariadb) {
                    format!("'{}'", esc.replace('\\', "\\\\"))
                } else if self.driver == Driver::Postgres && esc.contains('\\') {
                    format!("E'{}'", esc.replace('\\', "\\\\"))
                } else {
                    format!("'{esc}'")
                }
            }
            Value::Array(items)
                if self.driver == Driver::Postgres
                    && !hint.contains("json")
                    && items.iter().all(|i| !i.is_array() && !i.is_object()) =>
            {
                // Postgres array literal: '{a,b}' with elements double-quoted.
                let parts: Vec<String> = items
                    .iter()
                    .map(|i| match i {
                        Value::Null => "NULL".to_string(),
                        Value::String(s) => {
                            format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
                        }
                        other => other.to_string(),
                    })
                    .collect();
                format!("'{{{}}}'", parts.join(",").replace('\'', "''"))
            }
            Value::Array(_) | Value::Object(_) => {
                let s = serde_json::to_string(v).unwrap_or_default();
                // ponytail: assumes default sql_mode (backslash escapes on) for MySQL; NO_BACKSLASH_ESCAPES servers
                // need typed parameter binding instead of literals.
                self.literal_typed(&Value::String(s), None)
            }
        }
    }

    // ---------------------------------------------------------------- browsing

    /// A browse filter must be exactly one expression: no extra statements or trailing comments.
    pub fn validate_filter(&self, filter: Option<&str>) -> Result<()> {
        Self::validate_filter_for(self.driver, filter)
    }

    pub fn validate_filter_for(driver: Driver, filter: Option<&str>) -> Result<()> {
        let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) else {
            return Ok(());
        };
        // Comment markers and statement breaks only count outside '…' literals (an FK key value may
        // legitimately contain "--" or ";"). Only MySQL/MariaDB treat a backslash as an escape inside a
        // literal; on Postgres/SQLite `'a\'` is closed. Blanking literals first keeps `split_statements`
        // (which escapes backslashes for every dialect) from mis-splitting such keys.
        let backslash = matches!(driver, Driver::Mysql | Driver::Mariadb);
        let code = blank_string_literals(f, backslash);
        let parts = split_statements(&code);
        if parts.len() != 1
            || parts[0] != code.trim_end_matches(';').trim()
            || code.contains("--")
            || code.contains("/*")
        {
            return Err(AppError::Msg(
                "filter must be a single WHERE expression".into(),
            ));
        }
        Ok(())
    }

    /// The browse query for one page.
    pub fn select_sql(&self, q: &TableQuery) -> String {
        format!(
            "{} LIMIT {} OFFSET {}",
            self.select_all_sql(q),
            q.limit.max(1),
            q.offset
        )
    }

    /// The table with its filter and sort, every row (export).
    pub fn select_all_sql(&self, q: &TableQuery) -> String {
        let mut sql = format!(
            "SELECT * FROM {}",
            self.qualified(q.schema.as_deref(), &q.table)
        );
        if let Some(f) = q.filter.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
            sql.push_str(&format!(" WHERE {f}"));
        }
        if let Some(o) = q.order_by.as_deref().filter(|o| !o.is_empty()) {
            sql.push_str(&format!(
                " ORDER BY {} {}",
                self.quote_ident(o),
                if q.order_desc { "DESC" } else { "ASC" }
            ));
        }
        sql
    }

    pub async fn count(&self, q: &TableQuery) -> Result<i64> {
        let mut sql = format!(
            "SELECT COUNT(*) AS n FROM {}",
            self.qualified(q.schema.as_deref(), &q.table)
        );
        if let Some(f) = q.filter.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
            sql.push_str(&format!(" WHERE {f}"));
        }
        let r = self.run_one_read_only(&sql, 1).await?;
        Ok(r.rows
            .first()
            .and_then(|r| r.first())
            .and_then(json_i64)
            .unwrap_or(0))
    }

    /// Turn grid edits into SQL statements (not executed).
    pub fn change_sql(
        &self,
        schema: Option<&str>,
        table: &str,
        changes: &[RowChange],
        types: &HashMap<String, String>,
    ) -> Vec<String> {
        let t = self.qualified(schema, table);
        let lit = |k: &str, v: &Value| self.literal_typed(v, types.get(k).map(String::as_str));
        let where_of = |key: &HashMap<String, Value>| -> String {
            let mut parts: Vec<String> = key
                .iter()
                .map(|(k, v)| {
                    if v.is_null() {
                        format!("{} IS NULL", self.quote_ident(k))
                    } else {
                        format!("{} = {}", self.quote_ident(k), lit(k, v))
                    }
                })
                .collect();
            parts.sort();
            parts.join(" AND ")
        };
        changes
            .iter()
            .map(|c| match c {
                RowChange::Update { key, values } => {
                    let mut sets: Vec<String> = values
                        .iter()
                        .map(|(k, v)| format!("{} = {}", self.quote_ident(k), lit(k, v)))
                        .collect();
                    sets.sort();
                    format!("UPDATE {t} SET {} WHERE {}", sets.join(", "), where_of(key))
                }
                RowChange::Insert { values } if values.is_empty() => match self.driver {
                    Driver::Mysql | Driver::Mariadb => format!("INSERT INTO {t} () VALUES ()"),
                    _ => format!("INSERT INTO {t} DEFAULT VALUES"),
                },
                RowChange::Insert { values } => {
                    let mut cols: Vec<&String> = values.keys().collect();
                    cols.sort();
                    let names: Vec<String> = cols.iter().map(|c| self.quote_ident(c)).collect();
                    let vals: Vec<String> = cols.iter().map(|c| lit(c, &values[*c])).collect();
                    format!(
                        "INSERT INTO {t} ({}) VALUES ({})",
                        names.join(", "),
                        vals.join(", ")
                    )
                }
                RowChange::Delete { key } => format!("DELETE FROM {t} WHERE {}", where_of(key)),
            })
            .collect()
    }

    // ---------------------------------------------------------------- introspection

    pub async fn databases(&self) -> Result<Vec<String>> {
        let sql = match self.driver {
            Driver::Postgres => {
                "SELECT datname AS name FROM pg_database WHERE NOT datistemplate ORDER BY 1"
            }
            Driver::Mysql | Driver::Mariadb => "SHOW DATABASES",
            Driver::Sqlite => return Ok(vec!["main".into()]),
            _ => unreachable!(),
        };
        Ok(self
            .rows(sql)
            .await?
            .into_iter()
            .filter_map(|r| r.into_values().next())
            .filter_map(json_str)
            .collect())
    }

    pub async fn schemas(&self) -> Result<Vec<String>> {
        match self.driver {
            Driver::Postgres => {
                let sql = "SELECT nspname AS name FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%' ORDER BY (nspname <> 'public'), nspname";
                Ok(self
                    .rows(sql)
                    .await?
                    .into_iter()
                    .filter_map(|mut r| r.remove("name"))
                    .filter_map(json_str)
                    .collect())
            }
            Driver::Mysql | Driver::Mariadb => {
                let rows = self.rows("SELECT DATABASE() AS db").await?;
                let current = rows
                    .first()
                    .and_then(|r| r.get("db").cloned())
                    .and_then(json_str);
                let mut dbs: Vec<String> = self
                    .databases()
                    .await?
                    .into_iter()
                    .filter(|d| {
                        !matches!(
                            d.as_str(),
                            "information_schema" | "performance_schema" | "mysql" | "sys"
                        )
                    })
                    .collect();
                if let Some(c) = current {
                    dbs.sort_by_key(|d| (d != &c, d.clone()));
                }
                Ok(dbs)
            }
            Driver::Sqlite => Ok(self
                .rows("PRAGMA database_list")
                .await?
                .into_iter()
                .filter_map(|mut r| r.remove("name"))
                .filter_map(json_str)
                .filter(|n| n != "temp")
                .collect()),
            _ => unreachable!(),
        }
    }

    /// Where an unqualified table name resolves first (Postgres `current_schema()`, the MySQL
    /// database, SQLite `main`).
    pub async fn current_schema(&self) -> Result<String> {
        let sql = match self.driver {
            Driver::Postgres => "SELECT current_schema() AS name",
            Driver::Mysql | Driver::Mariadb => "SELECT DATABASE() AS name",
            _ => return Ok("main".into()),
        };
        Ok(self
            .rows(sql)
            .await?
            .into_iter()
            .next()
            .and_then(|mut r| r.remove("name"))
            .and_then(json_str)
            .unwrap_or_default())
    }

    pub async fn tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let rows = match self.driver {
            Driver::Postgres => {
                let sql = format!(
                    "SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, c.reltuples::bigint AS est \
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE c.relkind IN ('r','v','m','p','f') AND n.nspname = {} ORDER BY c.relname",
                    self.literal(&Value::String(schema.into()))
                );
                self.rows(&sql).await?
            }
            Driver::Mysql | Driver::Mariadb => {
                let sql = format!(
                    "SELECT TABLE_SCHEMA AS `schema`, TABLE_NAME AS name, TABLE_TYPE AS kind, TABLE_ROWS AS est \
                     FROM information_schema.TABLES WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME",
                    self.literal(&Value::String(schema.into()))
                );
                self.rows(&sql).await?
            }
            Driver::Sqlite => {
                let master = if schema == "main" {
                    "sqlite_master".to_string()
                } else {
                    format!("{}.sqlite_master", self.quote_ident(schema))
                };
                let sql = format!(
                    "SELECT {} AS schema, name, type AS kind, NULL AS est FROM {master} WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
                    self.literal(&Value::String(schema.into()))
                );
                self.rows(&sql).await?
            }
            _ => unreachable!(),
        };
        Ok(rows
            .into_iter()
            .map(|mut r| {
                let kind_raw = r.remove("kind").and_then(json_str).unwrap_or_default();
                let kind = match kind_raw.as_str() {
                    "r" | "p" | "BASE TABLE" | "table" | "SYSTEM VERSIONED" => "table",
                    "v" | "VIEW" | "view" | "SYSTEM VIEW" => "view",
                    "m" => "matview",
                    "f" => "foreign",
                    _ => "table",
                };
                TableInfo {
                    schema: r
                        .remove("schema")
                        .and_then(json_str)
                        .unwrap_or_else(|| schema.to_string()),
                    name: r.remove("name").and_then(json_str).unwrap_or_default(),
                    kind: kind.to_string(),
                    row_estimate: r
                        .remove("est")
                        .as_ref()
                        .and_then(json_i64)
                        .filter(|n| *n >= 0),
                }
            })
            .collect())
    }

    pub async fn table_details(&self, schema: &str, table: &str) -> Result<TableDetails> {
        let s = self.literal(&Value::String(schema.into()));
        let t = self.literal(&Value::String(table.into()));
        match self.driver {
            Driver::Postgres => {
                let cols = self
                    .rows(&format!(
                        "SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type, NOT a.attnotnull AS nullable, \
                         pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attnum AS pos, col_description(a.attrelid, a.attnum) AS comment, \
                         EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS is_pk \
                         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
                         WHERE a.attrelid = format('%I.%I', {s}, {t})::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum"
                    ))
                    .await?;
                let idx = self
                    .rows(&format!(
                        "SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS uniq, i.indisprimary AS pk, am.amname AS method, array_to_string(c.reloptions, ',') AS opts, \
                         (SELECT string_agg(oc.opcname, ',' ORDER BY u.ord) FROM unnest(i.indclass) WITH ORDINALITY AS u(oid, ord) JOIN pg_opclass oc ON oc.oid = u.oid) AS opclasses, \
                         (SELECT string_agg(pg_get_indexdef(i.indexrelid, k, true), ',' ORDER BY k) FROM generate_series(1, array_length(i.indkey::int[], 1)) k) AS cols \
                         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam WHERE i.indrelid = format('%I.%I', {s}, {t})::regclass ORDER BY c.relname"
                    ))
                    .await?;
                let fks = self
                    .rows(&format!(
                        "SELECT con.conname AS name, \
                         (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols, \
                         rn.nspname AS ref_schema, rc.relname AS ref_table, \
                         (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols \
                         FROM pg_constraint con JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
                         WHERE con.contype = 'f' AND con.conrelid = format('%I.%I', {s}, {t})::regclass ORDER BY con.conname"
                    ))
                    .await?;
                let columns: Vec<ColumnInfo> = cols
                    .into_iter()
                    .map(|mut r| ColumnInfo {
                        name: take_str(&mut r, "name"),
                        data_type: take_str(&mut r, "data_type"),
                        nullable: take_bool(&mut r, "nullable"),
                        default: opt_str(&mut r, "dflt"),
                        is_primary: take_bool(&mut r, "is_pk"),
                        position: take_i64(&mut r, "pos") as i32,
                        comment: opt_str(&mut r, "comment"),
                        extra: None,
                    })
                    .collect();
                let indexes: Vec<IndexInfo> = idx
                    .into_iter()
                    .map(|mut r| IndexInfo {
                        name: take_str(&mut r, "name"),
                        columns: split_csv(opt_str(&mut r, "cols")),
                        unique: take_bool(&mut r, "uniq"),
                        primary: take_bool(&mut r, "pk"),
                        definition: opt_str(&mut r, "def"),
                        method: opt_str(&mut r, "method"),
                        opclasses: split_csv(opt_str(&mut r, "opclasses")),
                        options: split_csv(opt_str(&mut r, "opts")),
                    })
                    .collect();
                let foreign_keys: Vec<ForeignKeyInfo> = fks
                    .into_iter()
                    .map(|mut r| ForeignKeyInfo {
                        name: take_str(&mut r, "name"),
                        columns: split_csv(opt_str(&mut r, "cols")),
                        ref_schema: opt_str(&mut r, "ref_schema"),
                        ref_table: take_str(&mut r, "ref_table"),
                        ref_columns: split_csv(opt_str(&mut r, "ref_cols")),
                    })
                    .collect();
                let view = self
                    .rows(&format!(
                        "SELECT pg_get_viewdef(format('%I.%I', {s}, {t})::regclass, true) AS def"
                    ))
                    .await
                    .ok()
                    .and_then(|r| r.into_iter().next())
                    .and_then(|mut r| opt_str(&mut r, "def"));
                let ddl = match view {
                    Some(def) => Some(format!(
                        "CREATE OR REPLACE VIEW {} AS\n{def}",
                        self.qualified(Some(schema), table)
                    )),
                    None => Some(self.synth_ddl(schema, table, &columns, &indexes, &foreign_keys)),
                };
                Ok(TableDetails {
                    columns,
                    indexes,
                    foreign_keys,
                    ddl,
                })
            }
            Driver::Mysql | Driver::Mariadb => {
                let cols = self
                    .rows(&format!(
                        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS data_type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, \
                         ORDINAL_POSITION AS pos, COLUMN_COMMENT AS comment, COLUMN_KEY AS ckey, EXTRA AS extra \
                         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {s} AND TABLE_NAME = {t} ORDER BY ORDINAL_POSITION"
                    ))
                    .await?;
                let idx = self
                    .rows(&format!(
                        "SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, MIN(NON_UNIQUE) AS non_unique \
                         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = {s} AND TABLE_NAME = {t} GROUP BY INDEX_NAME ORDER BY INDEX_NAME"
                    ))
                    .await?;
                let fks = self
                    .rows(&format!(
                        "SELECT CONSTRAINT_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols, \
                         REFERENCED_TABLE_SCHEMA AS ref_schema, REFERENCED_TABLE_NAME AS ref_table, \
                         GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS ref_cols \
                         FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = {s} AND TABLE_NAME = {t} AND REFERENCED_TABLE_NAME IS NOT NULL \
                         GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME ORDER BY CONSTRAINT_NAME"
                    ))
                    .await?;
                let ddl = self
                    .rows(&format!(
                        "SHOW CREATE TABLE {}",
                        self.qualified(Some(schema), table)
                    ))
                    .await
                    .ok()
                    .and_then(|r| r.into_iter().next())
                    .and_then(|r| {
                        r.get("Create Table")
                            .or_else(|| r.get("Create View"))
                            .cloned()
                            .and_then(json_str)
                    });
                Ok(TableDetails {
                    columns: cols
                        .into_iter()
                        .map(|mut r| ColumnInfo {
                            name: take_str(&mut r, "name"),
                            data_type: take_str(&mut r, "data_type"),
                            nullable: take_str(&mut r, "nullable") == "YES",
                            default: opt_str(&mut r, "dflt"),
                            is_primary: take_str(&mut r, "ckey") == "PRI",
                            position: take_i64(&mut r, "pos") as i32,
                            comment: opt_str(&mut r, "comment").filter(|c| !c.is_empty()),
                            extra: opt_str(&mut r, "extra").filter(|c| !c.is_empty()),
                        })
                        .collect(),
                    indexes: idx
                        .into_iter()
                        .map(|mut r| {
                            let name = take_str(&mut r, "name");
                            IndexInfo {
                                primary: name == "PRIMARY",
                                unique: take_i64(&mut r, "non_unique") == 0,
                                columns: split_csv(opt_str(&mut r, "cols")),
                                definition: None,
                                method: None,
                                opclasses: Vec::new(),
                                options: Vec::new(),
                                name,
                            }
                        })
                        .collect(),
                    foreign_keys: fks
                        .into_iter()
                        .map(|mut r| ForeignKeyInfo {
                            name: take_str(&mut r, "name"),
                            columns: split_csv(opt_str(&mut r, "cols")),
                            ref_schema: opt_str(&mut r, "ref_schema"),
                            ref_table: take_str(&mut r, "ref_table"),
                            ref_columns: split_csv(opt_str(&mut r, "ref_cols")),
                        })
                        .collect(),
                    ddl,
                })
            }
            Driver::Sqlite => {
                let q = self.quote_ident(table);
                let pfx = if schema == "main" || schema.is_empty() {
                    String::new()
                } else {
                    format!("{}.", self.quote_ident(schema))
                };
                let cols = self.rows(&format!("PRAGMA {pfx}table_info({q})")).await?;
                let idx_list = self.rows(&format!("PRAGMA {pfx}index_list({q})")).await?;
                let fk_rows = self
                    .rows(&format!("PRAGMA {pfx}foreign_key_list({q})"))
                    .await?;
                let mut indexes = vec![];
                for mut r in idx_list {
                    let name = take_str(&mut r, "name");
                    let info = self
                        .rows(&format!(
                            "PRAGMA {pfx}index_info({})",
                            self.quote_ident(&name)
                        ))
                        .await?;
                    indexes.push(IndexInfo {
                        columns: info
                            .into_iter()
                            .map(|mut c| take_str(&mut c, "name"))
                            .collect(),
                        unique: take_i64(&mut r, "unique") == 1,
                        primary: take_str(&mut r, "origin") == "pk",
                        definition: None,
                        method: None,
                        opclasses: Vec::new(),
                        options: Vec::new(),
                        name,
                    });
                }
                let mut fk_map: HashMap<i64, ForeignKeyInfo> = HashMap::new();
                for mut r in fk_rows {
                    let id = take_i64(&mut r, "id");
                    let e = fk_map.entry(id).or_insert_with(|| ForeignKeyInfo {
                        name: format!("fk_{id}"),
                        ref_table: take_str(&mut r, "table"),
                        ..Default::default()
                    });
                    e.columns.push(take_str(&mut r, "from"));
                    e.ref_columns.push(take_str(&mut r, "to"));
                }
                let master = if schema == "main" {
                    "sqlite_master".to_string()
                } else {
                    format!("{}.sqlite_master", self.quote_ident(schema))
                };
                let ddl = self
                    .rows(&format!("SELECT sql FROM {master} WHERE name = {t}"))
                    .await
                    .ok()
                    .and_then(|r| r.into_iter().next())
                    .and_then(|mut r| opt_str(&mut r, "sql"));
                // `REFERENCES parent` without a column list reports `to` as NULL: the target is the
                // parent's primary key.
                for fk in fk_map.values_mut() {
                    if !fk.ref_columns.iter().any(String::is_empty) {
                        continue;
                    }
                    let info = self
                        .rows(&format!(
                            "PRAGMA {pfx}table_info({})",
                            self.quote_ident(&fk.ref_table)
                        ))
                        .await?;
                    let mut pk: Vec<(i64, String)> = info
                        .into_iter()
                        .filter_map(|mut r| {
                            let n = take_i64(&mut r, "pk");
                            (n > 0).then(|| (n, take_str(&mut r, "name")))
                        })
                        .collect();
                    pk.sort();
                    if pk.len() == fk.ref_columns.len() {
                        fk.ref_columns = pk.into_iter().map(|(_, n)| n).collect();
                    }
                }
                let mut fks: Vec<_> = fk_map.into_values().collect();
                fks.sort_by(|a, b| a.name.cmp(&b.name));
                // `REFERENCES parent` without a column list reports `to` as NULL: resolve it to parent's PK.
                for fk in fks
                    .iter_mut()
                    .filter(|fk| fk.ref_columns.iter().any(String::is_empty))
                {
                    let mut pk: Vec<(i64, String)> = self
                        .rows(&format!(
                            "PRAGMA {pfx}table_info({})",
                            self.quote_ident(&fk.ref_table)
                        ))
                        .await?
                        .into_iter()
                        .filter_map(|mut r| {
                            let n = take_i64(&mut r, "pk");
                            (n > 0).then(|| (n, take_str(&mut r, "name")))
                        })
                        .collect();
                    pk.sort();
                    fk.ref_columns = pk.into_iter().map(|(_, n)| n).collect();
                }
                Ok(TableDetails {
                    columns: cols
                        .into_iter()
                        .map(|mut r| ColumnInfo {
                            name: take_str(&mut r, "name"),
                            data_type: take_str(&mut r, "type"),
                            nullable: take_i64(&mut r, "notnull") == 0,
                            default: opt_str(&mut r, "dflt_value"),
                            is_primary: take_i64(&mut r, "pk") > 0,
                            position: take_i64(&mut r, "cid") as i32 + 1,
                            comment: None,
                            extra: None,
                        })
                        .collect(),
                    indexes,
                    foreign_keys: fks,
                    ddl,
                })
            }
            _ => unreachable!(),
        }
    }

    /// Every table/view in `schema` with columns, indexes, FKs and DDL.
    // ponytail: N+1 introspection (a few queries per table); switch to bulk information_schema
    // queries if schemas with hundreds of tables feel slow.
    pub async fn schema_objects(&self, schema: &str) -> Result<Vec<SchemaObject>> {
        let mut out = vec![];
        for table in self.tables(schema).await? {
            let details = self.table_details(schema, &table.name).await?;
            out.push(SchemaObject { table, details });
        }
        Ok(out)
    }

    /// Columns and foreign keys of every table in `schema`, for editor completion.
    /// ponytail: whole-schema payload in one go; page or lazy-load per table if a schema with
    /// tens of thousands of columns ever shows up.
    pub async fn schema_catalog(&self, schema: &str) -> Result<SchemaCatalog> {
        let s = self.literal(&Value::String(schema.into()));
        let (cols, foreign_keys) = match self.driver {
            Driver::Postgres => (
                self.rows(&format!(
                    "SELECT c.relname AS tbl, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type \
                     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE n.nspname = {s} AND c.relkind IN ('r','v','m','p','f') AND a.attnum > 0 AND NOT a.attisdropped \
                     ORDER BY c.relname, a.attnum"
                ))
                .await?,
                self.rows(&format!(
                    "SELECT c.relname AS tbl, \
                     (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols, \
                     rn.nspname AS ref_schema, rc.relname AS ref_table, \
                     (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols \
                     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
                     JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
                     WHERE con.contype = 'f' AND n.nspname = {s} ORDER BY c.relname, con.conname"
                ))
                .await?
                .into_iter()
                .map(|mut r| CatalogForeignKey {
                    table: take_str(&mut r, "tbl"),
                    columns: take_names(&mut r, "cols"),
                    ref_schema: opt_str(&mut r, "ref_schema"),
                    ref_table: take_str(&mut r, "ref_table"),
                    ref_columns: take_names(&mut r, "ref_cols"),
                })
                .collect(),
            ),
            Driver::Mysql | Driver::Mariadb => (
                self.rows(&format!(
                    "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS data_type \
                     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {s} ORDER BY TABLE_NAME, ORDINAL_POSITION"
                ))
                .await?,
                // One row per key column, folded here: no GROUP_CONCAT, so no group_concat_max_len
                // truncation and no separator that could appear in a name.
                self.rows(&format!(
                    "SELECT TABLE_NAME AS tbl, CONSTRAINT_NAME AS name, COLUMN_NAME AS col, \
                     REFERENCED_TABLE_SCHEMA AS ref_schema, REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col \
                     FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = {s} AND REFERENCED_TABLE_NAME IS NOT NULL \
                     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION"
                ))
                .await?
                .into_iter()
                .fold(Vec::<(String, CatalogForeignKey)>::new(), |mut acc, mut r| {
                    let table = take_str(&mut r, "tbl");
                    let name = take_str(&mut r, "name");
                    let col = take_str(&mut r, "col");
                    let ref_col = take_str(&mut r, "ref_col");
                    match acc.last_mut() {
                        Some((n, fk)) if *n == name && fk.table == table => {
                            fk.columns.push(col);
                            fk.ref_columns.push(ref_col);
                        }
                        _ => acc.push((
                            name,
                            CatalogForeignKey {
                                table,
                                columns: vec![col],
                                ref_schema: opt_str(&mut r, "ref_schema"),
                                ref_table: take_str(&mut r, "ref_table"),
                                ref_columns: vec![ref_col],
                            },
                        )),
                    }
                    acc
                })
                .into_iter()
                .map(|(_, fk)| fk)
                .collect(),
            ),
            Driver::Sqlite => {
                // ponytail: one pragma pair per table (local file, cheap); no bulk catalog in SQLite.
                let mut out = SchemaCatalog::default();
                for t in self.tables(schema).await? {
                    let d = self.table_details(schema, &t.name).await?;
                    out.columns.extend(d.columns.into_iter().map(|c| CatalogColumn {
                        table: t.name.clone(),
                        name: c.name,
                        data_type: c.data_type,
                    }));
                    out.foreign_keys
                        .extend(d.foreign_keys.into_iter().map(|f| CatalogForeignKey {
                            table: t.name.clone(),
                            columns: f.columns,
                            ref_schema: f.ref_schema,
                            ref_table: f.ref_table,
                            ref_columns: f.ref_columns,
                        }));
                }
                return Ok(out);
            }
            _ => unreachable!(),
        };
        Ok(SchemaCatalog {
            columns: cols
                .into_iter()
                .map(|mut r| CatalogColumn {
                    table: take_str(&mut r, "tbl"),
                    name: take_str(&mut r, "name"),
                    data_type: take_str(&mut r, "data_type"),
                })
                .collect(),
            foreign_keys,
        })
    }

    fn synth_ddl(
        &self,
        schema: &str,
        table: &str,
        cols: &[ColumnInfo],
        idx: &[IndexInfo],
        fks: &[ForeignKeyInfo],
    ) -> String {
        let mut lines: Vec<String> = cols
            .iter()
            .map(|c| {
                let mut l = format!("  {} {}", self.quote_ident(&c.name), c.data_type);
                if !c.nullable {
                    l.push_str(" NOT NULL");
                }
                if let Some(d) = &c.default {
                    l.push_str(&format!(" DEFAULT {d}"));
                }
                l
            })
            .collect();
        if let Some(pk) = idx.iter().find(|i| i.primary) {
            lines.push(format!(
                "  PRIMARY KEY ({})",
                pk.columns
                    .iter()
                    .map(|c| self.quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        for fk in fks {
            lines.push(format!(
                "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
                self.quote_ident(&fk.name),
                fk.columns
                    .iter()
                    .map(|c| self.quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", "),
                self.qualified(fk.ref_schema.as_deref(), &fk.ref_table),
                fk.ref_columns
                    .iter()
                    .map(|c| self.quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        let mut out = format!(
            "CREATE TABLE {} (\n{}\n);",
            self.qualified(Some(schema), table),
            lines.join(",\n")
        );
        for i in idx.iter().filter(|i| !i.primary) {
            if let Some(d) = &i.definition {
                out.push_str(&format!("\n{d};"));
            }
        }
        out
    }
}

// ---------------------------------------------------------------- helpers

macro_rules! exec_stream {
    ($pool:expr, $sql:expr, $limit:expr, $conv:path) => {{
        #[allow(deprecated)]
        let mut stream = sqlx::query($sql).fetch_many($pool);
        let mut res = QueryResult::default();
        let mut failure: Option<sqlx::Error> = None;
        while let Some(item) = stream.next().await {
            let item = match item {
                Ok(i) => i,
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            };
            match item {
                Either::Left(done) => {
                    res.affected = Some(res.affected.unwrap_or(0) + done.rows_affected());
                }
                Either::Right(row) => {
                    if res.columns.is_empty() {
                        res.columns = row
                            .columns()
                            .iter()
                            .map(|c| Column {
                                name: c.name().to_string(),
                                type_name: c.type_info().name().to_string(),
                            })
                            .collect();
                    }
                    if res.rows.len() as u32 >= $limit {
                        res.truncated = true;
                        break;
                    }
                    res.rows
                        .push((0..row.len()).map(|i| $conv(&row, i)).collect());
                }
            }
        }
        drop(stream);
        match failure {
            Some(e) => Err::<QueryResult, AppError>(e.into()),
            None => Ok(res),
        }
    }};
}
use exec_stream;

/// Like `exec_stream`, but hands rows to a channel in batches instead of collecting them (export). Evaluates to
/// `Result<u64>`: the rows sent.
macro_rules! stream_batches {
    ($exec:expr, $sql:expr, $conv:path, $tx:expr, $stop:expr) => {{
        use crate::export::{BATCH_ROWS, Batch};
        use std::sync::atomic::Ordering;
        let mut stream = sqlx::query($sql).fetch($exec);
        let mut buf: Vec<Vec<Value>> = Vec::with_capacity(BATCH_ROWS);
        let mut sent: u64 = 0;
        let mut out: Result<u64> = Ok(0);
        loop {
            if $stop.load(Ordering::Relaxed) {
                break;
            }
            match stream.next().await {
                None => break,
                Some(Err(e)) => {
                    out = Err(e.into());
                    break;
                }
                Some(Ok(row)) => {
                    if sent == 0 && buf.is_empty() {
                        let cols = row.columns().iter().map(|c| c.name().to_string()).collect();
                        if $tx.send(Batch::Columns(cols)).await.is_err() {
                            break;
                        }
                    }
                    buf.push((0..row.len()).map(|i| $conv(&row, i)).collect());
                    if buf.len() >= BATCH_ROWS {
                        sent += buf.len() as u64;
                        if $tx
                            .send(Batch::Rows(std::mem::take(&mut buf)))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        }
        drop(stream);
        if out.is_ok() && !buf.is_empty() && !$stop.load(Ordering::Relaxed) {
            sent += buf.len() as u64;
            let _ = $tx.send(Batch::Rows(buf)).await;
        }
        out.map(|_| sent)
    }};
}
use stream_batches;

/// Replace the contents of single-quoted literals by spaces so lexical checks skip them.
/// `''` stays inside the literal; with `backslash` (MySQL dialects) so does a backslash-escaped character.
/// `backslash` is the dialect default (MySQL); a Postgres `E'…'` escape string enables it per literal.
fn blank_string_literals(sql: &str, backslash: bool) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut in_str = false;
    let mut esc = backslash;
    let mut prev = [' ', ' ']; // the two characters before the current one
    let mut chars = sql.chars();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if !in_str {
                let is_ident = |c: char| c.is_alphanumeric() || c == '_' || c == '"' || c == '`';
                esc = backslash || (matches!(prev[1], 'E' | 'e') && !is_ident(prev[0]));
            }
            in_str = !in_str;
            out.push(c);
        } else if in_str {
            out.push(' ');
            if esc && c == '\\' && chars.next().is_some() {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
        prev = [prev[1], c];
    }
    out
}

fn json_str(v: Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}
fn json_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.parse().ok(),
        Value::Bool(b) => Some(*b as i64),
        _ => None,
    }
}
fn take_str(r: &mut HashMap<String, Value>, k: &str) -> String {
    r.remove(k).and_then(json_str).unwrap_or_default()
}
fn opt_str(r: &mut HashMap<String, Value>, k: &str) -> Option<String> {
    r.remove(k).and_then(json_str)
}
fn take_i64(r: &mut HashMap<String, Value>, k: &str) -> i64 {
    r.remove(k).as_ref().and_then(json_i64).unwrap_or(0)
}
fn take_bool(r: &mut HashMap<String, Value>, k: &str) -> bool {
    match r.remove(k) {
        Some(Value::Bool(b)) => b,
        Some(v) => json_i64(&v).unwrap_or(0) != 0,
        None => false,
    }
}
/// Identifier list returned as a Postgres array (decoded to a JSON array).
fn take_names(r: &mut HashMap<String, Value>, k: &str) -> Vec<String> {
    match r.remove(k) {
        Some(Value::Array(a)) => a.into_iter().filter_map(json_str).collect(),
        _ => vec![],
    }
}

fn split_csv(s: Option<String>) -> Vec<String> {
    s.map(|s| {
        s.split(',')
            .map(|p| p.trim().trim_matches('"').to_string())
            .filter(|p| !p.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

/// Split a script on `;` outside strings, comments and dollar-quotes.
pub fn split_statements(sql: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let n = chars.len();
    while i < n {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        match c {
            '\'' | '"' | '`' => {
                let q = c;
                cur.push(c);
                i += 1;
                while i < n {
                    cur.push(chars[i]);
                    if chars[i] == q {
                        if chars.get(i + 1) == Some(&q) {
                            cur.push(q);
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    if chars[i] == '\\' && i + 1 < n {
                        i += 1;
                        cur.push(chars[i]);
                    }
                    i += 1;
                }
                i += 1;
            }
            '-' if next == Some('-') => {
                while i < n && chars[i] != '\n' {
                    cur.push(chars[i]);
                    i += 1;
                }
            }
            '#' if cur.trim().is_empty() => {
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
            }
            '/' if next == Some('*') => {
                cur.push_str("/*");
                i += 2;
                while i < n && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                    cur.push(chars[i]);
                    i += 1;
                }
                cur.push_str("*/");
                i += 2;
            }
            '$' => {
                // $tag$ ... $tag$
                let mut j = i + 1;
                while j < n && (chars[j].is_alphanumeric() || chars[j] == '_') {
                    j += 1;
                }
                if j < n && chars[j] == '$' {
                    let tag: String = chars[i..=j].iter().collect();
                    let rest: String = chars[i..].iter().collect();
                    if let Some(end) = rest[tag.len()..].find(&tag) {
                        let total = tag.len() + end + tag.len();
                        cur.push_str(&rest[..total]);
                        i += total;
                        continue;
                    }
                }
                cur.push(c);
                i += 1;
            }
            ';' => {
                if has_code(&cur) {
                    out.push(cur.trim().to_string());
                }
                cur.clear();
                i += 1;
            }
            _ => {
                cur.push(c);
                i += 1;
            }
        }
    }
    if has_code(&cur) {
        out.push(cur.trim().to_string());
    }
    out
}

/// True when the text contains something besides whitespace and comments.
fn has_code(s: &str) -> bool {
    let mut rest = s;
    loop {
        rest = rest.trim_start();
        if let Some(r) = rest.strip_prefix("--") {
            rest = r.split_once('\n').map(|(_, t)| t).unwrap_or("");
        } else if let Some(r) = rest.strip_prefix("/*") {
            rest = r.split_once("*/").map(|(_, t)| t).unwrap_or("");
        } else {
            return !rest.is_empty();
        }
    }
}

pub fn is_query_like(sql: &str) -> bool {
    let first = first_word(sql);
    matches!(
        first.as_str(),
        "SELECT"
            | "WITH"
            | "SHOW"
            | "EXPLAIN"
            | "DESCRIBE"
            | "DESC"
            | "VALUES"
            | "TABLE"
            | "PRAGMA"
    )
}

/// Conservative read-only check used to gate agent tool calls: true when nothing in `sql` is classified as a write.
pub fn is_read_only(driver: Driver, sql: &str) -> bool {
    classify_writes(driver, sql).is_empty()
}

/// A statement that is not read-only: what it does and (when the AST tells us) which table it touches.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WriteInfo {
    pub kind: String,
    pub table: Option<String>,
}

fn dialect(driver: Driver) -> Box<dyn sqlparser::dialect::Dialect> {
    use sqlparser::dialect::{MySqlDialect, PostgreSqlDialect, SQLiteDialect};
    match driver {
        Driver::Mysql | Driver::Mariadb => Box::new(MySqlDialect {}),
        Driver::Sqlite => Box::new(SQLiteDialect {}),
        _ => Box::new(PostgreSqlDialect {}),
    }
}

/// Describe every write statement in `sql` (kind + target table) for the read-only gate and the
/// production confirmation prompt. Classification runs per `split_statements` piece, the same unit
/// `Sql::run` executes, so the parser and the executor cannot disagree on where a statement ends.
/// Fails closed: a piece the parser rejects (or parses to nothing) is reported as a write with its
/// first keyword and no table, except bare metadata commands (SHOW / DESCRIBE).
pub fn classify_writes(driver: Driver, sql: &str) -> Vec<WriteInfo> {
    let d = dialect(driver);
    let unparsed = |s: &str| {
        let first = first_word(s);
        if matches!(first.as_str(), "SHOW" | "DESCRIBE" | "DESC") && !s.contains(';') {
            vec![]
        } else {
            vec![WriteInfo {
                kind: format!("{first} (could not parse)"),
                table: None,
            }]
        }
    };
    let mut out: Vec<WriteInfo> = split_statements(sql)
        .iter()
        .flat_map(|s| match sqlparser::parser::Parser::parse_sql(&*d, s) {
            Ok(stmts) if !stmts.is_empty() => stmts.iter().flat_map(describe_writes).collect(),
            Ok(_) if !has_code(s) => vec![],
            _ => unparsed(s),
        })
        .collect();
    // MySQL runs `/*! ... */` executable comments that both splitter and parser treat as plain comments.
    if matches!(driver, Driver::Mysql | Driver::Mariadb) && sql.contains("/*!") {
        out.insert(
            0,
            WriteInfo {
                kind: "EXECUTABLE COMMENT".into(),
                table: None,
            },
        );
    }
    out
}

fn write_info(kind: &str, table: Option<String>) -> Vec<WriteInfo> {
    vec![WriteInfo {
        kind: kind.into(),
        table,
    }]
}

fn names(list: impl IntoIterator<Item = impl ToString>) -> Option<String> {
    let v: Vec<String> = list.into_iter().map(|n| n.to_string()).collect();
    (!v.is_empty()).then(|| v.join(", "))
}

/// Writes hidden inside a query: SELECT INTO (in any set member), data-modifying CTEs.
fn query_writes(q: &sqlparser::ast::Query) -> Vec<WriteInfo> {
    use sqlparser::ast::SetExpr;
    fn body_writes(b: &SetExpr) -> Vec<WriteInfo> {
        match b {
            SetExpr::Select(sel) => sel
                .into
                .as_ref()
                .map(|i| write_info("SELECT INTO", Some(i.name.to_string())))
                .unwrap_or_default(),
            SetExpr::Insert(st) | SetExpr::Update(st) => describe_writes(st),
            SetExpr::Query(inner) => query_writes(inner),
            SetExpr::SetOperation { left, right, .. } => {
                [body_writes(left), body_writes(right)].concat()
            }
            _ => vec![],
        }
    }
    let mut out: Vec<WriteInfo> = q
        .with
        .iter()
        .flat_map(|w| w.cte_tables.iter().flat_map(|c| query_writes(&c.query)))
        .collect();
    out.extend(body_writes(&q.body));
    out
}

/// Every write a single statement performs; empty when the statement is read-only.
fn describe_writes(s: &sqlparser::ast::Statement) -> Vec<WriteInfo> {
    use sqlparser::ast::{FromTable, Statement, TableFactor};
    fn table_of(t: &TableFactor) -> Option<String> {
        match t {
            TableFactor::Table { name, .. } => Some(name.to_string()),
            _ => None,
        }
    }
    match s {
        Statement::Query(q) => query_writes(q),
        Statement::Explain {
            analyze,
            statement,
            options,
            ..
        } => {
            // Postgres `EXPLAIN (ANALYZE, ...)` lands in `options`, not `analyze`; any ANALYZE option counts.
            let analyzes = *analyze
                || options
                    .iter()
                    .flatten()
                    .any(|o| o.name.value.eq_ignore_ascii_case("analyze"));
            if !analyzes {
                return vec![];
            }
            describe_writes(statement)
                .into_iter()
                .map(|w| WriteInfo {
                    kind: format!("EXPLAIN ANALYZE {}", w.kind),
                    table: w.table,
                })
                .collect()
        }
        Statement::ExplainTable { .. }
        | Statement::ShowColumns { .. }
        | Statement::ShowTables { .. }
        | Statement::ShowCreate { .. }
        | Statement::ShowFunctions { .. }
        | Statement::ShowVariable { .. }
        | Statement::ShowVariables { .. }
        | Statement::ShowStatus { .. }
        | Statement::ShowDatabases { .. }
        | Statement::ShowSchemas { .. }
        | Statement::ShowViews { .. }
        | Statement::ShowCollation { .. } => vec![],
        Statement::Pragma { value: None, .. } => vec![],
        Statement::Insert(i) => write_info("INSERT", Some(i.table_name.to_string())),
        Statement::Update { table, .. } => write_info("UPDATE", table_of(&table.relation)),
        Statement::Delete(d) => {
            // MySQL `DELETE t1, t2 FROM ...` names its targets explicitly; otherwise the FROM table is the target.
            // ponytail: explicit targets are shown as written (aliases not resolved); resolve against FROM if it misleads.
            let from = match &d.from {
                FromTable::WithFromKeyword(t) | FromTable::WithoutKeyword(t) => t,
            };
            let table =
                names(&d.tables).or_else(|| from.first().and_then(|t| table_of(&t.relation)));
            write_info("DELETE", table)
        }
        Statement::Merge { table, .. } => write_info("MERGE", table_of(table)),
        Statement::Truncate { table_names, .. } => {
            write_info("TRUNCATE", names(table_names.iter().map(|t| &t.name)))
        }
        Statement::AlterTable { name, .. } => write_info("ALTER TABLE", Some(name.to_string())),
        Statement::CreateTable(c) => write_info("CREATE TABLE", Some(c.name.to_string())),
        Statement::Drop {
            object_type,
            names: targets,
            ..
        } => write_info(&format!("DROP {object_type}"), names(targets)),
        // ponytail: everything else is a write named by its first keyword, no table; extend the match when a prompt is too vague.
        _ => write_info(&first_word(&s.to_string()), None),
    }
}

/// Append `LIMIT n` to a single statement that parses as a plain query without its own
/// LIMIT / OFFSET / FETCH / locking clause. Everything else comes back untouched, so the
/// agent's `run_sql` never turns valid SQL into invalid SQL.
pub fn with_limit(driver: Driver, stmt: &str, limit: u32) -> String {
    use sqlparser::ast::{SetExpr, Statement};
    let Ok(parsed) = sqlparser::parser::Parser::parse_sql(&*dialect(driver), stmt) else {
        return stmt.to_string();
    };
    match parsed.as_slice() {
        [Statement::Query(q)]
            if q.limit.is_none()
                && q.limit_by.is_empty()
                && q.offset.is_none()
                && q.fetch.is_none()
                && q.locks.is_empty()
                && q.for_clause.is_none()
                && !matches!(q.body.as_ref(), SetExpr::Select(s) if s.into.is_some()) =>
        {
            // On its own line: the statement may end in a `--` comment.
            format!(
                "{}\nLIMIT {limit}",
                stmt.trim_end().trim_end_matches(';').trim_end()
            )
        }
        _ => stmt.to_string(),
    }
}

/// What a piece of SQL touches: tables as `(schema, table)` and every function it calls (lowercased).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SqlRefs {
    pub tables: Vec<(Option<String>, String)>,
    pub functions: Vec<String>,
    /// Statements whose targets the visitor does not report (SHOW, DESCRIBE, PRAGMA, ...).
    pub opaque: Vec<String>,
    /// Query bodies and table factors the collector does not understand (`TABLE x`, PIVOT, JSON_TABLE, ...).
    /// Scoped runs refuse them: a construct that is not modelled cannot be checked.
    pub unsupported: Vec<String>,
}

/// Every table the SQL reads or writes, with identifiers normalised the way the database resolves
/// them (Postgres folds unquoted names to lowercase; MySQL and SQLite keep them). CTE names are
/// skipped only where they are lexically visible, table-valued functions always (they are reported
/// under `functions`). `None` when the text does not parse, so callers can fail closed.
pub fn referenced_tables(driver: Driver, sql: &str) -> Option<SqlRefs> {
    use sqlparser::ast::{
        Expr, Ident, ObjectName, Query, SetExpr, Statement, TableFactor, Visit, Visitor,
    };
    use std::ops::ControlFlow;
    /// One `WITH` clause: its names become visible one by one (all at once when RECURSIVE).
    struct Frame {
        owner: *const Query,
        recursive: bool,
        names: Vec<String>,
        bodies: Vec<*const Query>,
        visible: usize,
    }
    #[derive(Default)]
    struct Collector {
        driver_folds: bool,
        frames: Vec<Frame>,
        /// The `name` nodes of table-valued functions, so only those exact nodes are skipped.
        function_names: Vec<*const ObjectName>,
        functions: Vec<String>,
        relations: Vec<ObjectName>,
        opaque: Vec<String>,
        unsupported: Vec<String>,
    }
    /// Function names as the database resolves them: quotes dropped, lowercased.
    fn function_key(n: &ObjectName) -> String {
        n.0.iter()
            .map(|i| i.value.to_lowercase())
            .collect::<Vec<_>>()
            .join(".")
    }
    impl Collector {
        /// Every body kind is named so a sqlparser upgrade that adds one fails to compile here
        /// instead of slipping past the scope check. Set-operation arms are bodies too, not queries.
        fn check_body(&mut self, body: &SetExpr) {
            match body {
                SetExpr::Select(_) | SetExpr::Query(_) | SetExpr::Values(_) => {}
                SetExpr::Insert(_) | SetExpr::Update(_) => {}
                SetExpr::SetOperation { left, right, .. } => {
                    self.check_body(left);
                    self.check_body(right);
                }
                // `TABLE x`: the parser keeps only the raw words, so quoting (and thus case folding)
                // is lost and the name cannot be matched against the catalog reliably.
                SetExpr::Table(_) => self.unsupported.push("TABLE statements".into()),
            }
        }
        fn norm(&self, i: &Ident) -> String {
            if i.quote_style.is_none() && self.driver_folds {
                i.value.to_lowercase()
            } else {
                i.value.clone()
            }
        }
    }
    impl Visitor for Collector {
        type Break = ();
        fn pre_visit_query(&mut self, q: &Query) -> ControlFlow<()> {
            self.check_body(&q.body);
            // Entering CTE body i of a non-recursive WITH: only earlier CTEs are visible.
            if let Some(f) = self.frames.last_mut()
                && !f.recursive
                && let Some(i) = f.bodies.iter().position(|b| std::ptr::eq(*b, q))
            {
                f.visible = i;
            }
            if let Some(w) = &q.with {
                let names: Vec<String> = w
                    .cte_tables
                    .iter()
                    .map(|c| self.norm(&c.alias.name))
                    .collect();
                self.frames.push(Frame {
                    owner: q,
                    recursive: w.recursive,
                    visible: if w.recursive { names.len() } else { 0 },
                    bodies: w
                        .cte_tables
                        .iter()
                        .map(|c| &*c.query as *const Query)
                        .collect(),
                    names,
                });
            }
            ControlFlow::Continue(())
        }
        fn post_visit_query(&mut self, q: &Query) -> ControlFlow<()> {
            if self.frames.last().is_some_and(|f| std::ptr::eq(f.owner, q)) {
                self.frames.pop();
            }
            if let Some(f) = self.frames.last_mut()
                && !f.recursive
                && let Some(i) = f.bodies.iter().position(|b| std::ptr::eq(*b, q))
            {
                f.visible = i + 1;
            }
            ControlFlow::Continue(())
        }
        fn pre_visit_table_factor(&mut self, tf: &TableFactor) -> ControlFlow<()> {
            match tf {
                // `FROM fn(...)`: the name is visited as a relation, so remember the node to skip it.
                TableFactor::Table {
                    name,
                    args: Some(_),
                    ..
                } => {
                    self.function_names.push(name);
                    self.functions.push(function_key(name));
                }
                // `LATERAL fn(...)`: a distinct factor whose name is not visited as a relation.
                TableFactor::Function { name, .. } => self.functions.push(function_key(name)),
                TableFactor::Table { .. }
                | TableFactor::Derived { .. }
                | TableFactor::NestedJoin { .. }
                | TableFactor::UNNEST { .. } => {}
                TableFactor::TableFunction { .. } => self.unsupported.push("TABLE(...)".into()),
                TableFactor::JsonTable { .. } => self.unsupported.push("JSON_TABLE".into()),
                TableFactor::OpenJsonTable { .. } => self.unsupported.push("OPENJSON".into()),
                TableFactor::Pivot { .. } => self.unsupported.push("PIVOT".into()),
                TableFactor::Unpivot { .. } => self.unsupported.push("UNPIVOT".into()),
                TableFactor::MatchRecognize { .. } => {
                    self.unsupported.push("MATCH_RECOGNIZE".into())
                }
            }
            ControlFlow::Continue(())
        }
        fn pre_visit_statement(&mut self, st: &Statement) -> ControlFlow<()> {
            if !matches!(
                st,
                Statement::Query(_)
                    | Statement::Insert(_)
                    | Statement::Update { .. }
                    | Statement::Delete(_)
                    | Statement::Explain { .. }
            ) {
                let text = st.to_string();
                let head: Vec<&str> = text.split_whitespace().take(2).collect();
                self.opaque.push(head.join(" "));
            }
            ControlFlow::Continue(())
        }
        fn pre_visit_expr(&mut self, e: &Expr) -> ControlFlow<()> {
            if let Expr::Function(f) = e {
                self.functions.push(function_key(&f.name));
            }
            ControlFlow::Continue(())
        }
        fn pre_visit_relation(&mut self, r: &ObjectName) -> ControlFlow<()> {
            let is_cte = r.0.len() == 1
                && self.frames.iter().any(|f| {
                    let n = self.norm(&r.0[0]);
                    f.names[..f.visible].contains(&n)
                });
            let is_function = self.function_names.iter().any(|n| std::ptr::eq(*n, r));
            if !is_cte && !is_function {
                self.relations.push(r.clone());
            }
            ControlFlow::Continue(())
        }
    }
    let stmts = sqlparser::parser::Parser::parse_sql(&*dialect(driver), sql).ok()?;
    let mut c = Collector {
        driver_folds: driver == Driver::Postgres,
        ..Default::default()
    };
    let _ = stmts.visit(&mut c);
    Some(SqlRefs {
        tables: c
            .relations
            .iter()
            .map(|r| {
                let mut parts: Vec<String> = r.0.iter().map(|i| c.norm(i)).collect();
                let table = parts.pop().unwrap_or_default();
                (parts.pop(), table)
            })
            .collect(),
        functions: c.functions,
        opaque: c.opaque,
        unsupported: c.unsupported,
    })
}

fn first_word(sql: &str) -> String {
    sql.trim_start()
        .split(|c: char| c.is_whitespace() || c == '(')
        .find(|w| !w.is_empty())
        .unwrap_or("")
        .to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filter_allows_comment_markers_inside_literals() {
        let pg = |f| SqlConn::validate_filter_for(Driver::Postgres, Some(f));
        let my = |f| SqlConn::validate_filter_for(Driver::Mysql, Some(f));
        assert!(pg("\"code\" = 'a--b' AND \"x\" = 'it''s /* ok */'").is_ok());
        // Backslash escapes only exist in MySQL dialects; on Postgres `'a\'` is a closed literal + comment.
        assert!(my("\"x\" = 'a\\' -- '").is_ok());
        assert!(pg("\"x\" = 'a\\' -- '").is_err());
        // Semicolons inside literals never split, whatever the splitter thinks of the backslash.
        assert!(pg("\"x\" = 'a\\'';b'").is_ok());
        assert!(my("\"x\" = 'a\\';b'").is_ok());
        assert!(pg("\"x\" = 'a'; delete from t").is_err());
        // Postgres escape strings do use backslashes: E'\'' is one quote, not a closed literal.
        assert!(pg("\"x\" = E'a\\'b'").is_ok());
        assert!(pg("\"x\" = E'\\'' ; delete from t; --'").is_err());
        assert!(pg("\"x\" = e'\\'' ; delete from t; --'").is_err());
        assert!(pg("\"some\" = 'E'; delete from t").is_err()); // a literal E is not a prefix
        assert!(pg("\"id\" = 1 -- drop").is_err());
        assert!(pg("\"id\" = 1 /* c */").is_err());
        assert!(pg("\"id\" = 1; delete from t").is_err());
    }

    #[test]
    fn classifies_writes_for_confirmation() {
        let w = |k: &str, t: Option<&str>| WriteInfo {
            kind: k.into(),
            table: t.map(String::from),
        };
        assert_eq!(
            classify_writes(
                Driver::Postgres,
                "select 1; update public.users set a = 1; delete from t where id = 2; \
                 insert into \"Order\" values (1); drop table x; truncate t2; alter table t3 add c int; \
                 create table n (id int)"
            ),
            vec![
                w("UPDATE", Some("public.users")),
                w("DELETE", Some("t")),
                w("INSERT", Some("\"Order\"")),
                w("DROP TABLE", Some("x")),
                w("TRUNCATE", Some("t2")),
                w("ALTER TABLE", Some("t3")),
                w("CREATE TABLE", Some("n")),
            ]
        );
        assert!(classify_writes(Driver::Mysql, "SHOW TABLES; select * from t").is_empty());
        // writes hidden inside queries / explain
        assert_eq!(
            classify_writes(
                Driver::Postgres,
                "select 1 into new_t from t; explain analyze update u set a = 1; \
                 with x as (select 1) insert into t select * from x"
            ),
            vec![
                w("SELECT INTO", Some("new_t")),
                w("EXPLAIN ANALYZE UPDATE", Some("u")),
                w("INSERT", Some("t")),
            ]
        );
        // unparseable script: statements are retried one by one, the bad one fails closed
        assert_eq!(
            classify_writes(
                Driver::Postgres,
                "select 1; select 1 into new_t from t; select '"
            ),
            vec![
                w("SELECT INTO", Some("new_t")),
                w("SELECT (could not parse)", None)
            ]
        );
        // several modifying CTEs are all listed; MySQL multi-table delete names its explicit targets
        assert_eq!(
            classify_writes(
                Driver::Postgres,
                "with a as (insert into t1 values (1) returning *), b as (update t2 set x = 1 returning *) select 1"
            ),
            vec![w("INSERT", Some("t1")), w("UPDATE", Some("t2"))]
        );
        assert_eq!(
            classify_writes(
                Driver::Mysql,
                "delete orders from users join orders on orders.user_id = users.id"
            ),
            vec![w("DELETE", Some("orders"))]
        );
        // every DROP target; Postgres option-style EXPLAIN (ANALYZE); SELECT INTO inside a UNION arm
        assert_eq!(
            classify_writes(
                Driver::Postgres,
                "drop table a, b; explain (analyze, buffers) delete from users; explain (costs) delete from users; \
                 select * into bak from users union select * from old"
            ),
            vec![
                w("DROP TABLE", Some("a, b")),
                w("EXPLAIN ANALYZE DELETE", Some("users")),
                w("SELECT INTO", Some("bak")),
            ]
        );
        // classifier and executor split on the same boundaries: a write hidden by a nested comment or a
        // mid-line `#` is still seen; MySQL executable comments fail closed
        assert!(
            !classify_writes(
                Driver::Postgres,
                "/* /* */ ; drop table users; /* */ */ select 1"
            )
            .is_empty()
        );
        assert_eq!(
            classify_writes(Driver::Mysql, "select 1 # ; drop table users"),
            vec![w("DROP TABLE", Some("users"))]
        );
        assert_eq!(
            classify_writes(Driver::Mysql, "/*!50000 drop table users */"),
            vec![w("EXECUTABLE COMMENT", None)]
        );
        assert!(classify_writes(Driver::Mysql, "-- just a comment").is_empty());
        assert!(is_read_only(Driver::Mysql, "SHOW TABLES"));
        assert!(!is_read_only(
            Driver::Postgres,
            "explain (analyze) delete from t"
        ));
    }

    #[test]
    fn splits_and_classifies() {
        let parts = split_statements(
            "select 1; -- c;\nselect ';' as x; /* a; */ insert into t values ($$a;b$$)",
        );
        assert_eq!(parts.len(), 3);
        assert!(parts[1].ends_with("select ';' as x"), "{}", parts[1]);
        assert_eq!(split_statements("select 1; -- trailing").len(), 1);
        assert!(!has_code(" /* x */ -- y\n"));
        assert!(is_read_only(
            Driver::Postgres,
            "select * from t where a = 'drop'"
        ));
        assert!(!is_read_only(Driver::Postgres, "delete from t"));
        assert!(!is_read_only(
            Driver::Postgres,
            "with x as (select 1) insert into t select * from x"
        ));
        assert!(is_read_only(Driver::Mysql, "SHOW TABLES"));
        assert!(!is_read_only(
            Driver::Postgres,
            "EXPLAIN ANALYZE DELETE FROM t"
        ));
        assert!(is_read_only(Driver::Postgres, "EXPLAIN DELETE FROM t"));
        assert!(!is_read_only(Driver::Sqlite, "PRAGMA user_version = 3"));
        assert!(is_read_only(Driver::Sqlite, "PRAGMA user_version"));
        assert!(!is_read_only(
            Driver::Postgres,
            "WITH x AS (select 1) FROBNICATE"
        ));
        assert!(SqlConn::validate_filter_for(Driver::Postgres, Some("id = 1")).is_ok());
        assert!(
            SqlConn::validate_filter_for(Driver::Postgres, Some("0; DELETE FROM t; --")).is_err()
        );
        assert!(SqlConn::validate_filter_for(Driver::Postgres, Some("name = 'a;b'")).is_ok());
    }

    #[test]
    fn limit_and_scope_helpers() {
        let pg = Driver::Postgres;
        assert_eq!(
            with_limit(pg, "select * from t -- note", 50),
            "select * from t -- note\nLIMIT 50"
        );
        assert_eq!(
            with_limit(pg, "with x as (select 1) select * from x;", 5),
            "with x as (select 1) select * from x\nLIMIT 5"
        );
        for untouched in [
            "select * from t limit 10",
            "select * from t offset 5",
            "select * from t for update",
            "delete from t",
            "select * from t where",
            "select * into t2 from t",
        ] {
            assert_eq!(with_limit(pg, untouched, 7), untouched, "{untouched}");
        }
        assert_eq!(
            with_limit(Driver::Mysql, "select * from `t`", 3),
            "select * from `t`\nLIMIT 3"
        );

        let t = |sql: &str| referenced_tables(pg, sql).unwrap().tables;
        assert_eq!(
            t("select a.id from public.users a join orders o on o.uid = a.id"),
            vec![
                (Some("public".into()), "users".into()),
                (None, "orders".into())
            ]
        );
        assert_eq!(
            t("with recent as (select * from events) select * from recent, generate_series(1, 3)"),
            vec![(None, "events".into())]
        );
        assert_eq!(
            t("insert into audit.log (a) select a from src"),
            vec![(Some("audit".into()), "log".into()), (None, "src".into())]
        );
        assert_eq!(t("select 1"), Vec::<(Option<String>, String)>::new());
        assert!(referenced_tables(pg, "select * from").is_none());
        // CTE names only shadow where they are visible.
        assert_eq!(
            t("with secret as (select 1) select * from secret; select * from secret"),
            vec![(None, "secret".into())]
        );
        assert_eq!(
            t("with a as (select * from a), b as (select * from a) select * from b"),
            vec![(None, "a".into())]
        );
        assert_eq!(
            t("with recursive a as (select 1 union select * from a) select * from a"),
            Vec::<(Option<String>, String)>::new()
        );
        assert_eq!(
            t("select * from (with x as (select 1) select * from x) y, x"),
            vec![(None, "x".into())]
        );
        // Identifier folding follows the dialect.
        assert_eq!(
            t(r#"select * from Public."Users", users"#),
            vec![
                (Some("public".into()), "Users".into()),
                (None, "users".into())
            ]
        );
        assert_eq!(
            referenced_tables(Driver::Mysql, "select * from App.Users")
                .unwrap()
                .tables,
            vec![(Some("App".into()), "Users".into())]
        );
        // Table functions are skipped only at their own node; calls are reported.
        assert_eq!(
            t("select * from generate_series(1, 1); select * from generate_series"),
            vec![(None, "generate_series".into())]
        );
        assert_eq!(
            referenced_tables(
                pg,
                "select query_to_xml('select 1', true, false, ''), Upper(x) from t"
            )
            .unwrap()
            .functions,
            vec!["query_to_xml", "upper"]
        );
        assert_eq!(
            referenced_tables(pg, r#"select "query_to_xml"('select 1', true, false, '')"#)
                .unwrap()
                .functions,
            vec!["query_to_xml"]
        );
        assert_eq!(
            referenced_tables(Driver::Sqlite, "select * from pragma_table_info('t')")
                .unwrap()
                .functions,
            vec!["pragma_table_info"]
        );
        // Statements the visitor cannot see into are reported so scoped runs can refuse them.
        let r = referenced_tables(Driver::Mysql, "show create table x.t; show tables").unwrap();
        assert!(r.tables.is_empty());
        assert_eq!(r.opaque, vec!["SHOW CREATE", "SHOW TABLES"]);
        assert!(
            referenced_tables(pg, "explain select * from t")
                .unwrap()
                .opaque
                .is_empty()
        );
    }

    /// Every way a scoped agent could reach a table the parsed table list does not show.
    #[test]
    fn scope_fails_closed() {
        let pg = Driver::Postgres;
        let r = |sql: &str| {
            referenced_tables(pg, sql).unwrap_or_else(|| panic!("did not parse: {sql}"))
        };
        // `TABLE x` is a query body without a FROM (reachable in CTEs, subqueries and set operations);
        // the parser drops identifier quoting, so it is refused rather than matched.
        assert!(referenced_tables(pg, "TABLE other.secrets").is_none());
        for sql in [
            "with x as (table other.secrets) select * from x",
            "select * from (table other.secrets) t",
            "select 1 union all table other.secrets",
        ] {
            let refs = r(sql);
            assert_eq!(refs.unsupported, vec!["TABLE statements"], "{sql}");
            assert!(refs.tables.is_empty(), "{sql}");
        }
        // LATERAL function calls are a distinct table factor and must hit the function blocklist.
        assert_eq!(
            r("select * from lateral pg_read_file('/etc/passwd') f").functions,
            vec!["pg_read_file"]
        );
        let lat = r("select * from t, lateral jsonb_each(t.doc) x");
        assert_eq!(lat.tables, vec![(None, "t".into())]);
        assert_eq!(lat.functions, vec!["jsonb_each"]);
        assert!(lat.unsupported.is_empty());
        // search_path changes are either opaque statements or a flagged function call.
        assert_eq!(
            r("SET search_path TO other").opaque,
            vec!["SET search_path"]
        );
        assert_eq!(
            r("select set_config('search_path', 'other', false)").functions,
            vec!["set_config"]
        );
        // Table factors the collector does not understand are reported, not passed.
        assert_eq!(
            r("select * from t pivot (sum(x) for y in ('a'))").unsupported,
            vec!["PIVOT"]
        );
        // The everyday shapes stay clean.
        assert!(
            r("select * from (select 1) d, unnest(array[1]) u, (t join s on t.id = s.id)")
                .unsupported
                .is_empty()
        );
    }
}
