use crate::config::{ConnectionConfig, ConnectionSecrets};
use crate::error::{AppError, Result};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub struct RedisConn {
    conn: MultiplexedConnection,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RedisKey {
    pub key: String,
    pub kind: String,
    pub ttl: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub cursor: String,
    pub keys: Vec<RedisKey>,
}

impl RedisConn {
    pub async fn connect(c: &ConnectionConfig, s: &ConnectionSecrets) -> Result<RedisConn> {
        let url = match &c.url {
            Some(u) => {
                let mut u = url::Url::parse(u).map_err(|e| AppError::Msg(format!("invalid url: {e}")))?;
                if u.password().is_none()
                    && let Some(pw) = s.password.as_deref().filter(|p| !p.is_empty()) {
                        let _ = u.set_password(Some(pw));
                    }
                u.to_string()
            }
            None => {
                let scheme = if c.ssl_mode.as_deref().is_some_and(|m| m != "disable" && m != "prefer") { "rediss" } else { "redis" };
                let mut u = url::Url::parse(&format!("{scheme}://{}:{}/{}", c.host, if c.port == 0 { 6379 } else { c.port }, if c.database.is_empty() { "0" } else { &c.database }))
                    .map_err(|e| AppError::Msg(format!("invalid redis target: {e}")))?;
                if !c.user.is_empty() {
                    let _ = u.set_username(&c.user);
                }
                if let Some(pw) = s.password.as_deref().filter(|p| !p.is_empty()) {
                    let _ = u.set_password(Some(pw));
                }
                u.to_string()
            }
        };
        let client = redis::Client::open(url)?;
        let conn = tokio::time::timeout(std::time::Duration::from_secs(15), client.get_multiplexed_async_connection())
            .await
            .map_err(|_| AppError::Msg("redis connection timed out".into()))??;
        Ok(RedisConn { conn })
    }

    fn con(&self) -> MultiplexedConnection {
        self.conn.clone()
    }

    pub async fn scan(&self, cursor: &str, pattern: &str, count: u32) -> Result<ScanResult> {
        let mut con = self.con();
        let (next, keys): (String, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(if pattern.is_empty() { "*" } else { pattern })
            .arg("COUNT")
            .arg(count)
            .query_async(&mut con)
            .await?;
        let mut pipe = redis::pipe();
        for k in &keys {
            pipe.cmd("TYPE").arg(k).cmd("TTL").arg(k);
        }
        let meta: Vec<redis::Value> = if keys.is_empty() { vec![] } else { pipe.query_async(&mut con).await? };
        let out = keys
            .into_iter()
            .enumerate()
            .map(|(i, key)| RedisKey {
                key,
                kind: meta.get(i * 2).map(|v| to_json(v.clone()).as_str().unwrap_or("").to_string()).unwrap_or_default(),
                ttl: meta.get(i * 2 + 1).and_then(|v| to_json(v.clone()).as_i64()).unwrap_or(-1),
            })
            .collect();
        Ok(ScanResult { cursor: next, keys: out })
    }

    pub async fn get_key(&self, key: &str) -> Result<Value> {
        let mut con = self.con();
        let kind: String = redis::cmd("TYPE").arg(key).query_async(&mut con).await?;
        let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut con).await?;
        let value: redis::Value = match kind.as_str() {
            "string" => redis::cmd("GET").arg(key).query_async(&mut con).await?,
            "hash" => redis::cmd("HGETALL").arg(key).query_async(&mut con).await?,
            "list" => redis::cmd("LRANGE").arg(key).arg(0).arg(999).query_async(&mut con).await?,
            "set" => redis::cmd("SMEMBERS").arg(key).query_async(&mut con).await?,
            "zset" => redis::cmd("ZRANGE").arg(key).arg(0).arg(999).arg("WITHSCORES").query_async(&mut con).await?,
            "stream" => redis::cmd("XRANGE").arg(key).arg("-").arg("+").arg("COUNT").arg(200).query_async(&mut con).await?,
            "none" => return Err(AppError::Msg(format!("key '{key}' does not exist"))),
            _ => redis::Value::Nil,
        };
        let size: i64 = match kind.as_str() {
            "string" => redis::cmd("STRLEN").arg(key).query_async(&mut con).await.unwrap_or(0),
            "hash" => redis::cmd("HLEN").arg(key).query_async(&mut con).await.unwrap_or(0),
            "list" => redis::cmd("LLEN").arg(key).query_async(&mut con).await.unwrap_or(0),
            "set" => redis::cmd("SCARD").arg(key).query_async(&mut con).await.unwrap_or(0),
            "zset" => redis::cmd("ZCARD").arg(key).query_async(&mut con).await.unwrap_or(0),
            "stream" => redis::cmd("XLEN").arg(key).query_async(&mut con).await.unwrap_or(0),
            _ => 0,
        };
        let mut value = to_json(value);
        // RESP2 returns hashes as a flat [field, value, ...] array; normalise to an object.
        if kind == "hash"
            && let Value::Array(items) = &value {
                let mut map = serde_json::Map::new();
                for pair in items.chunks(2) {
                    if let [k, v] = pair {
                        map.insert(k.as_str().map(str::to_string).unwrap_or_else(|| k.to_string()), v.clone());
                    }
                }
                value = Value::Object(map);
            }
        Ok(json!({ "key": key, "type": kind, "ttl": ttl, "size": size, "value": value }))
    }

    /// Run a raw command given as whitespace separated text (quotes honoured).
    pub async fn command(&self, line: &str) -> Result<Value> {
        self.exec(&shell_split(line)).await
    }

    /// Run a command from pre-split arguments (no quoting rules apply; safe for arbitrary keys/values).
    pub async fn exec(&self, args: &[String]) -> Result<Value> {
        let Some((name, rest)) = args.split_first() else { return Err(AppError::Msg("empty command".into())) };
        let mut cmd = redis::cmd(name);
        for a in rest {
            cmd.arg(a);
        }
        let v: redis::Value = cmd.query_async(&mut self.con()).await?;
        Ok(to_json(v))
    }

    pub async fn info(&self) -> Result<Value> {
        let mut con = self.con();
        let info: String = redis::cmd("INFO").query_async(&mut con).await?;
        let dbsize: i64 = redis::cmd("DBSIZE").query_async(&mut con).await?;
        let mut map = serde_json::Map::new();
        for line in info.lines() {
            if let Some((k, v)) = line.split_once(':') {
                map.insert(k.to_string(), Value::String(v.trim().to_string()));
            }
        }
        map.insert("dbsize".into(), json!(dbsize));
        Ok(Value::Object(map))
    }
}

pub fn is_read_only_command(line: &str) -> bool {
    is_read_only_args(&shell_split(line))
}

pub fn is_read_only_args(args: &[String]) -> bool {
    let name = args.first().map(|s| s.to_uppercase()).unwrap_or_default();
    matches!(
        name.as_str(),
        "GET" | "MGET" | "HGET" | "HGETALL" | "HMGET" | "HKEYS" | "HVALS" | "HLEN" | "HEXISTS" | "LRANGE" | "LLEN" | "LINDEX"
            | "SMEMBERS" | "SCARD" | "SISMEMBER" | "ZRANGE" | "ZRANGEBYSCORE" | "ZREVRANGE" | "ZCARD" | "ZSCORE" | "ZRANK"
            | "SCAN" | "SSCAN" | "HSCAN" | "ZSCAN" | "KEYS" | "TYPE" | "TTL" | "PTTL" | "EXISTS" | "STRLEN" | "DBSIZE"
            | "INFO" | "PING" | "ECHO" | "TIME" | "XRANGE" | "XREVRANGE" | "XLEN" | "XINFO" | "OBJECT" | "MEMORY"
            | "RANDOMKEY" | "GETRANGE" | "BITCOUNT" | "PFCOUNT" | "GEOPOS" | "GEODIST" | "JSON.GET" | "FT.SEARCH" | "DUMP"
    )
}

fn shell_split(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) if c == '\\' => {
                if let Some(n) = chars.next() {
                    cur.push(match n {
                        'n' => '\n',
                        't' => '\t',
                        o => o,
                    });
                }
            }
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                has = true;
            }
            None if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            None => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub fn to_json(v: redis::Value) -> Value {
    use redis::Value as R;
    match v {
        R::Nil => Value::Null,
        R::Int(i) => json!(i),
        R::BulkString(b) => super::value::bytes_value(&b),
        R::Array(a) => Value::Array(a.into_iter().map(to_json).collect()),
        R::SimpleString(s) => Value::String(s),
        R::Okay => Value::String("OK".into()),
        R::Map(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| (to_json(k).as_str().map(str::to_string).unwrap_or_else(|| "?".into()), to_json(v)))
                .collect(),
        ),
        R::Set(a) => Value::Array(a.into_iter().map(to_json).collect()),
        R::Double(d) => json!(d),
        R::Boolean(b) => Value::Bool(b),
        R::VerbatimString { text, .. } => Value::String(text),
        R::BigNumber(n) => Value::String(n.to_string()),
        R::Attribute { data, .. } => to_json(*data),
        R::Push { data, .. } => Value::Array(data.into_iter().map(to_json).collect()),
        R::ServerError(e) => Value::String(format!("ERR {}", e.details().unwrap_or(""))),
    }
}
