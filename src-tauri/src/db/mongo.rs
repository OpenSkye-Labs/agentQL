use crate::config::{ConnectionConfig, ConnectionSecrets};
use crate::error::{AppError, Result};
use futures::TryStreamExt;
use mongodb::bson::{Bson, Document, doc};
use mongodb::{Client, options::ClientOptions};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub struct MongoConn {
    client: Client,
    pub default_db: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MongoFind {
    pub db: String,
    pub collection: String,
    #[serde(default)]
    pub filter: Option<Value>,
    #[serde(default)]
    pub sort: Option<Value>,
    #[serde(default)]
    pub projection: Option<Value>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub skip: u64,
}
fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
pub struct MongoPage {
    pub docs: Vec<Value>,
    pub total: Option<u64>,
}

impl MongoConn {
    pub async fn connect(
        c: &ConnectionConfig,
        s: &ConnectionSecrets,
        tunneled: bool,
    ) -> Result<MongoConn> {
        let uri = match &c.url {
            Some(u) => match s.password.as_deref().filter(|p| !p.is_empty()) {
                Some(pw) => crate::config::url_with_password(u, &c.user, pw),
                None => u.clone(),
            },
            None => {
                let auth = if c.user.is_empty() {
                    String::new()
                } else {
                    format!(
                        "{}:{}@",
                        urlenc(&c.user),
                        urlenc(s.password.as_deref().unwrap_or(""))
                    )
                };
                let mut q = vec![];
                if !c.user.is_empty() {
                    q.push(format!(
                        "authSource={}",
                        c.options
                            .get("authSource")
                            .cloned()
                            .unwrap_or_else(|| "admin".into())
                    ));
                }
                if c.ssl_mode
                    .as_deref()
                    .is_some_and(|m| m != "disable" && m != "prefer")
                {
                    q.push("tls=true".into());
                }
                format!(
                    "mongodb://{auth}{}:{}/{}{}{}",
                    c.host,
                    if c.port == 0 { 27017 } else { c.port },
                    c.database,
                    if q.is_empty() { "" } else { "?" },
                    q.join("&")
                )
            }
        };
        let mut opts = ClientOptions::parse(&uri).await?;
        opts.app_name = Some("AgentQL".into());
        opts.server_selection_timeout = Some(std::time::Duration::from_secs(10));
        opts.connect_timeout = Some(std::time::Duration::from_secs(10));
        if tunneled {
            // ponytail: a tunnel only reaches one node, so bypass replica-set discovery
            opts.direct_connection = Some(true);
            opts.repl_set_name = None;
        }
        let default_db = opts
            .default_database
            .clone()
            .or_else(|| Some(c.database.clone()).filter(|d| !d.is_empty()));
        let client = Client::with_options(opts)?;
        // Fail fast if the server is unreachable.
        client
            .database("admin")
            .run_command(doc! {"ping": 1})
            .await?;
        Ok(MongoConn { client, default_db })
    }

    pub async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.client.list_database_names().await?)
    }

    pub async fn collections(&self, db: &str) -> Result<Vec<Value>> {
        let d = self.client.database(db);
        let mut names = d.list_collection_names().await?;
        names.sort();
        let mut out = vec![];
        for n in names {
            let count = d
                .collection::<Document>(&n)
                .estimated_document_count()
                .await
                .ok();
            out.push(json!({ "name": n, "count": count }));
        }
        Ok(out)
    }

    pub async fn find(&self, q: &MongoFind) -> Result<MongoPage> {
        let coll = self
            .client
            .database(&q.db)
            .collection::<Document>(&q.collection);
        let filter = to_doc(q.filter.as_ref())?.unwrap_or_default();
        let mut find = coll.find(filter.clone()).limit(q.limit.max(1)).skip(q.skip);
        if let Some(sort) = to_doc(q.sort.as_ref())? {
            find = find.sort(sort);
        }
        if let Some(projection) = to_doc(q.projection.as_ref())? {
            find = find.projection(projection);
        }
        let mut cursor = find.await?;
        let mut docs = vec![];
        while let Some(d) = cursor.try_next().await? {
            docs.push(Bson::Document(d).into_relaxed_extjson());
        }
        let total = coll.count_documents(filter).await.ok();
        Ok(MongoPage { docs, total })
    }

    pub async fn aggregate(
        &self,
        db: &str,
        collection: &str,
        pipeline: &Value,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let coll = self.client.database(db).collection::<Document>(collection);
        let stages: Vec<Document> = pipeline
            .as_array()
            .ok_or_else(|| AppError::Msg("pipeline must be a JSON array".into()))?
            .iter()
            .map(|s| to_doc(Some(s)).map(|d| d.unwrap_or_default()))
            .collect::<Result<_>>()?;
        let mut cursor = coll.aggregate(stages).await?;
        let mut out = vec![];
        while let Some(d) = cursor.try_next().await? {
            out.push(Bson::Document(d).into_relaxed_extjson());
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    pub async fn insert(&self, db: &str, collection: &str, document: &Value) -> Result<Value> {
        let coll = self.client.database(db).collection::<Document>(collection);
        let d = to_doc(Some(document))?
            .ok_or_else(|| AppError::Msg("document must be an object".into()))?;
        let r = coll.insert_one(d).await?;
        Ok(r.inserted_id.into_relaxed_extjson())
    }

    pub async fn replace(
        &self,
        db: &str,
        collection: &str,
        id: &Value,
        document: &Value,
    ) -> Result<u64> {
        let coll = self.client.database(db).collection::<Document>(collection);
        let id: Bson = Bson::try_from(id.clone()).map_err(|e| AppError::Msg(e.to_string()))?;
        let mut d = to_doc(Some(document))?
            .ok_or_else(|| AppError::Msg("document must be an object".into()))?;
        d.remove("_id");
        let r = coll.replace_one(doc! {"_id": id}, d).await?;
        Ok(r.modified_count)
    }

    pub async fn delete(&self, db: &str, collection: &str, id: &Value) -> Result<u64> {
        let coll = self.client.database(db).collection::<Document>(collection);
        let id: Bson = Bson::try_from(id.clone()).map_err(|e| AppError::Msg(e.to_string()))?;
        Ok(coll.delete_one(doc! {"_id": id}).await?.deleted_count)
    }

    pub async fn collection_info(&self, db: &str, collection: &str) -> Result<Value> {
        let d = self.client.database(db);
        let stats = d
            .run_command(doc! {"collStats": collection, "scale": 1})
            .await
            .ok()
            .map(|s| Bson::Document(s).into_relaxed_extjson());
        let mut cursor = d.collection::<Document>(collection).list_indexes().await?;
        let mut indexes = vec![];
        while let Some(i) = cursor.try_next().await? {
            indexes.push(json!({ "name": i.options.as_ref().and_then(|o| o.name.clone()), "keys": Bson::Document(i.keys).into_relaxed_extjson(), "unique": i.options.as_ref().and_then(|o| o.unique).unwrap_or(false) }));
        }
        // Sample a few documents to infer a rough field list for the agent/UI.
        let mut sample = d
            .collection::<Document>(collection)
            .aggregate(vec![doc! {"$sample": {"size": 20}}])
            .await?;
        let mut fields = std::collections::BTreeMap::<String, String>::new();
        while let Some(doc) = sample.try_next().await? {
            for (k, v) in doc.iter() {
                fields
                    .entry(k.clone())
                    .or_insert_with(|| bson_type_name(v).to_string());
            }
        }
        Ok(json!({ "stats": stats, "indexes": indexes, "fields": fields }))
    }

    pub async fn run_command(&self, db: &str, command: &Value) -> Result<Value> {
        let d = to_doc(Some(command))?
            .ok_or_else(|| AppError::Msg("command must be an object".into()))?;
        Ok(Bson::Document(self.client.database(db).run_command(d).await?).into_relaxed_extjson())
    }
}

fn to_doc(v: Option<&Value>) -> Result<Option<Document>> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(Value::String(s)) => {
            let parsed: Value =
                serde_json::from_str(s).map_err(|e| AppError::Msg(format!("invalid JSON: {e}")))?;
            to_doc(Some(&parsed))
        }
        Some(v) => {
            let b: Bson = Bson::try_from(v.clone())
                .map_err(|e| AppError::Msg(format!("invalid document: {e}")))?;
            match b {
                Bson::Document(d) => Ok(Some(d)),
                _ => Err(AppError::Msg("expected a JSON object".into())),
            }
        }
    }
}

fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Decimal128(_) => "decimal",
        Bson::Binary(_) => "binary",
        Bson::Timestamp(_) => "timestamp",
        Bson::RegularExpression(_) => "regex",
        _ => "mixed",
    }
}

fn urlenc(s: &str) -> String {
    crate::config::pct_encode(s)
}

pub fn pipeline_writes(p: &Value) -> bool {
    p.as_array()
        .map(|a| {
            a.iter()
                .any(|s| s.get("$out").is_some() || s.get("$merge").is_some())
        })
        .unwrap_or(false)
}

/// What an aggregation pipeline writes, for the production prompt: `$out replaces db.coll` or
/// `$merge into db.coll` (no db = the pipeline's own database). None when it writes nothing.
pub fn pipeline_write_target(p: &Value) -> Option<String> {
    let name = |v: &Value| match v {
        Value::String(c) => Some(c.clone()),
        Value::Object(o) => {
            let coll = o.get("coll").and_then(Value::as_str)?;
            Some(match o.get("db").and_then(Value::as_str) {
                Some(db) => format!("{db}.{coll}"),
                None => coll.to_string(),
            })
        }
        _ => None,
    };
    p.as_array()?.iter().find_map(|s| {
        if let Some(v) = s.get("$out") {
            Some(format!(
                "$out replaces {}",
                name(v).unwrap_or_else(|| "?".into())
            ))
        } else {
            let m = s.get("$merge")?;
            let into = m.get("into").unwrap_or(m);
            Some(format!(
                "$merge into {}",
                name(into).unwrap_or_else(|| "?".into())
            ))
        }
    })
}

/// Commands that never modify data; everything else is treated as a write.
pub fn is_read_only_command(command: &Value) -> bool {
    let Some(name) = command.as_object().and_then(|o| o.keys().next()) else {
        return false;
    };
    let write_pipeline = command
        .get("pipeline")
        .map(pipeline_writes)
        .unwrap_or(false);
    !write_pipeline
        && matches!(
            name.as_str(),
            "collStats"
                | "dbStats"
                | "buildInfo"
                | "count"
                | "distinct"
                | "find"
                | "aggregate"
                | "listIndexes"
                | "listCollections"
                | "listDatabases"
                | "serverStatus"
                | "ping"
                | "explain"
                | "hello"
                | "isMaster"
                | "getParameter"
                | "validate"
                | "connectionStatus"
                | "hostInfo"
                | "currentOp"
                | "top"
                | "getLog"
                | "profile"
                | "whatsmyuri"
        )
}
