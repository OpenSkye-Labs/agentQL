//! Dynamic row -> JSON conversion for the three sqlx drivers.

use base64::Engine;
use serde_json::{Value, json};
use sqlx::{Row, TypeInfo, ValueRef};

pub fn bytes_value(b: &[u8]) -> Value {
    match std::str::from_utf8(b) {
        Ok(s) if !s.contains('\0') => Value::String(s.to_string()),
        _ => {
            json!({ "$bytes": base64::engine::general_purpose::STANDARD.encode(b), "len": b.len() })
        }
    }
}

fn num_f64(v: f64) -> Value {
    serde_json::Number::from_f64(v)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(v.to_string()))
}

// ---------------- Postgres ----------------

pub fn pg_value(row: &sqlx::postgres::PgRow, i: usize) -> Value {
    use sqlx::postgres::types::{Oid, PgInterval, PgMoney, PgTimeTz};
    use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
    use sqlx::types::{BigDecimal, BitVec, Uuid, ipnetwork::IpNetwork, mac_address::MacAddress};

    let raw = match row.try_get_raw(i) {
        Ok(r) => r,
        Err(e) => return Value::String(format!("<error: {e}>")),
    };
    if raw.is_null() {
        return Value::Null;
    }
    let name = raw.type_info().name().to_uppercase();

    macro_rules! get {
        ($t:ty, $f:expr) => {
            row.try_get::<$t, usize>(i).ok().map($f)
        };
    }
    macro_rules! vec {
        ($t:ty, $f:expr) => {
            row.try_get::<Vec<Option<$t>>, usize>(i).ok().map(|v| {
                Value::Array(
                    v.into_iter()
                        .map(|e| e.map($f).unwrap_or(Value::Null))
                        .collect(),
                )
            })
        };
    }

    let v: Option<Value> = match name.as_str() {
        "BOOL" => get!(bool, Value::Bool),
        "INT2" => get!(i16, |v| json!(v)),
        "INT4" => get!(i32, |v| json!(v)),
        "INT8" => get!(i64, |v| json!(v)),
        "OID" => get!(Oid, |v| json!(v.0)),
        "FLOAT4" => get!(f32, |v| num_f64(v as f64)),
        "FLOAT8" => get!(f64, num_f64),
        "NUMERIC" => get!(BigDecimal, |v| Value::String(v.normalized().to_string())),
        "MONEY" => get!(PgMoney, |v| Value::String(format!(
            "{}{}.{:02}",
            if v.0 < 0 { "-" } else { "" },
            (v.0 / 100).abs(),
            (v.0 % 100).abs()
        ))),
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "\"CHAR\"" | "CITEXT" | "XML"
        | "UNKNOWN" => {
            get!(String, Value::String)
        }
        "UUID" => get!(Uuid, |v| Value::String(v.to_string())),
        "TIMESTAMP" => get!(NaiveDateTime, |v| Value::String(
            v.format("%Y-%m-%d %H:%M:%S%.f").to_string()
        )),
        "TIMESTAMPTZ" => get!(DateTime<Utc>, |v| Value::String(
            v.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
        )),
        "DATE" => get!(NaiveDate, |v| Value::String(v.to_string())),
        "TIME" => get!(NaiveTime, |v| Value::String(v.to_string())),
        "TIMETZ" => get!(PgTimeTz, |v| Value::String(format!(
            "{}{}",
            v.time, v.offset
        ))),
        "INTERVAL" => get!(PgInterval, |v| Value::String(format_interval(
            v.months,
            v.days,
            v.microseconds
        ))),
        "JSON" | "JSONB" => get!(Value, |v| v),
        "BYTEA" => get!(Vec<u8>, |v| bytes_value(&v)),
        "INET" | "CIDR" => get!(IpNetwork, |v| Value::String(v.to_string())),
        "MACADDR" => get!(MacAddress, |v| Value::String(v.to_string())),
        "BIT" | "VARBIT" => get!(BitVec, |v| Value::String(
            v.iter().map(|b| if b { '1' } else { '0' }).collect()
        )),
        "BOOL[]" => vec![bool, Value::Bool],
        "INT2[]" => vec![i16, |v| json!(v)],
        "INT4[]" => vec![i32, |v| json!(v)],
        "INT8[]" => vec![i64, |v| json!(v)],
        "FLOAT4[]" => vec![f32, |v| num_f64(v as f64)],
        "FLOAT8[]" => vec![f64, num_f64],
        "NUMERIC[]" => vec![BigDecimal, |v| Value::String(v.normalized().to_string())],
        "TEXT[]" | "VARCHAR[]" | "CHAR[]" | "BPCHAR[]" | "NAME[]" => vec![String, Value::String],
        "UUID[]" => vec![Uuid, |v| Value::String(v.to_string())],
        "JSON[]" | "JSONB[]" => vec![Value, |v| v],
        "DATE[]" => vec![NaiveDate, |v| Value::String(v.to_string())],
        "TIMESTAMP[]" => vec![NaiveDateTime, |v| Value::String(v.to_string())],
        "TIMESTAMPTZ[]" => vec![DateTime<Utc>, |v| Value::String(v.to_rfc3339())],
        _ => None,
    };
    v.unwrap_or_else(|| {
        // enums, domains, ranges, custom types: text representation when available
        match raw.as_str() {
            Ok(s) => Value::String(s.to_string()),
            Err(_) => raw.as_bytes().map(bytes_value).unwrap_or(Value::Null),
        }
    })
}

fn format_interval(months: i32, days: i32, micros: i64) -> String {
    let mut parts = vec![];
    if months != 0 {
        let y = months / 12;
        let m = months % 12;
        if y != 0 {
            parts.push(format!("{y} year{}", if y.abs() == 1 { "" } else { "s" }));
        }
        if m != 0 {
            parts.push(format!("{m} mon{}", if m.abs() == 1 { "" } else { "s" }));
        }
    }
    if days != 0 {
        parts.push(format!(
            "{days} day{}",
            if days.abs() == 1 { "" } else { "s" }
        ));
    }
    if micros != 0 || parts.is_empty() {
        let neg = micros < 0;
        let a = micros.abs();
        let h = a / 3_600_000_000;
        let m = (a / 60_000_000) % 60;
        let s = (a / 1_000_000) % 60;
        let us = a % 1_000_000;
        let mut t = format!("{}{:02}:{:02}:{:02}", if neg { "-" } else { "" }, h, m, s);
        if us != 0 {
            t.push_str(format!(".{:06}", us).trim_end_matches('0'));
        }
        parts.push(t);
    }
    parts.join(" ")
}

// ---------------- MySQL / MariaDB ----------------

pub fn mysql_value(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    use sqlx::types::BigDecimal;
    use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

    let raw = match row.try_get_raw(i) {
        Ok(r) => r,
        Err(e) => return Value::String(format!("<error: {e}>")),
    };
    if raw.is_null() {
        return Value::Null;
    }
    let name = raw.type_info().name().to_uppercase();
    macro_rules! get {
        ($t:ty, $f:expr) => {
            row.try_get::<$t, usize>(i).ok().map($f)
        };
    }
    let v: Option<Value> = match name.as_str() {
        "BOOLEAN" | "TINYINT" => get!(i8, |v| json!(v)),
        "TINYINT UNSIGNED" => get!(u8, |v| json!(v)),
        "SMALLINT" => get!(i16, |v| json!(v)),
        "SMALLINT UNSIGNED" | "YEAR" => get!(u16, |v| json!(v)),
        "INT" | "MEDIUMINT" => get!(i32, |v| json!(v)),
        "INT UNSIGNED" | "MEDIUMINT UNSIGNED" => get!(u32, |v| json!(v)),
        "BIGINT" => get!(i64, |v| json!(v)),
        "BIGINT UNSIGNED" => get!(u64, |v| json!(v)),
        "BIT" => get!(u64, |v| json!(v)),
        "FLOAT" => get!(f32, |v| num_f64(v as f64)),
        "DOUBLE" => get!(f64, num_f64),
        "DECIMAL" => get!(BigDecimal, |v| Value::String(v.normalized().to_string())),
        "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => {
            get!(String, Value::String)
        }
        "DATE" => get!(NaiveDate, |v| Value::String(v.to_string())),
        "TIME" => get!(sqlx::mysql::types::MySqlTime, |v| Value::String(
            v.to_string()
        )),
        "DATETIME" => get!(NaiveDateTime, |v| Value::String(
            v.format("%Y-%m-%d %H:%M:%S%.f").to_string()
        )),
        "TIMESTAMP" => get!(DateTime<Utc>, |v| Value::String(
            v.format("%Y-%m-%d %H:%M:%S%.f").to_string()
        )),
        "JSON" => get!(Value, |v| v),
        "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" | "GEOMETRY" => {
            get!(Vec<u8>, |v| bytes_value(&v))
        }
        _ => None,
    };
    v.or_else(|| row.try_get::<String, usize>(i).ok().map(Value::String))
        .or_else(|| {
            row.try_get::<Vec<u8>, usize>(i)
                .ok()
                .map(|b| bytes_value(&b))
        })
        .unwrap_or(Value::Null)
}

// ---------------- SQLite ----------------

pub fn sqlite_value(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    let raw = match row.try_get_raw(i) {
        Ok(r) => r,
        Err(e) => return Value::String(format!("<error: {e}>")),
    };
    if raw.is_null() {
        return Value::Null;
    }
    let name = raw.type_info().name().to_uppercase();
    let v: Option<Value> = match name.as_str() {
        "INTEGER" | "INT" | "BIGINT" | "BOOLEAN" => {
            row.try_get::<i64, usize>(i).ok().map(|v| json!(v))
        }
        "REAL" | "FLOAT" | "DOUBLE" | "NUMERIC" => row.try_get::<f64, usize>(i).ok().map(num_f64),
        "BLOB" => row
            .try_get::<Vec<u8>, usize>(i)
            .ok()
            .map(|b| bytes_value(&b)),
        _ => None,
    };
    v.or_else(|| row.try_get::<String, usize>(i).ok().map(Value::String))
        .or_else(|| row.try_get::<i64, usize>(i).ok().map(|v| json!(v)))
        .or_else(|| row.try_get::<f64, usize>(i).ok().map(num_f64))
        .or_else(|| {
            row.try_get::<Vec<u8>, usize>(i)
                .ok()
                .map(|b| bytes_value(&b))
        })
        .unwrap_or(Value::Null)
}
