//! Agent sessions, the tool-use loop and UI event plumbing.

pub mod providers;
pub mod tools;

use crate::config::{LlmProvider, Store};
use crate::db::Manager;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub blocks: Vec<Block>,
    pub ts: String,
}

impl Message {
    pub fn new(role: &str, blocks: Vec<Block>) -> Self {
        Message {
            role: role.into(),
            blocks,
            ts: chrono::Utc::now().to_rfc3339(),
        }
    }
    pub fn text(&self) -> String {
        self.blocks
            .iter()
            .filter_map(|b| match b {
                Block::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatSession {
    pub id: String,
    pub connection_id: String,
    pub provider_id: String,
    pub title: String,
    #[serde(default)]
    pub messages: Vec<Message>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub cli_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        content: String,
        is_error: bool,
        display: Option<Value>,
    },
    ApprovalRequest {
        id: String,
        description: String,
        statement: String,
    },
    Status {
        text: String,
    },
    Done {
        session: ChatSession,
    },
    Error {
        message: String,
    },
}

#[derive(Serialize, Clone)]
struct EventEnvelope<'a> {
    session_id: &'a str,
    event: &'a AgentEvent,
}

/// Process-wide agent state.
pub struct Agent {
    pub pending_approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    pub running: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    pub mcp_token: String,
    pub mcp_port: OnceLock<u16>,
}

impl Default for Agent {
    fn default() -> Self {
        use rand::Rng;
        let token: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(40)
            .map(char::from)
            .collect();
        Agent {
            pending_approvals: Mutex::new(HashMap::new()),
            running: Mutex::new(HashMap::new()),
            mcp_token: token,
            mcp_port: OnceLock::new(),
        }
    }
}

#[derive(Clone)]
pub struct Ctx {
    pub app: AppHandle,
    pub manager: Arc<Manager>,
    pub store: Arc<Store>,
    pub agent: Arc<Agent>,
}

impl Ctx {
    pub fn emit(&self, session_id: &str, event: &AgentEvent) {
        let _ = self
            .app
            .emit("ai:event", EventEnvelope { session_id, event });
    }

    pub fn load_session(&self, id: &str) -> Result<ChatSession> {
        let path = self.store.dir().join("chats").join(format!("{id}.json"));
        let data = std::fs::read(&path)
            .map_err(|_| AppError::Msg(format!("chat session {id} not found")))?;
        Ok(serde_json::from_slice(&data)?)
    }

    pub fn save_session(&self, s: &mut ChatSession) -> Result<()> {
        s.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.write(&format!("chats/{}.json", s.id), s)
    }

    pub fn list_sessions(&self) -> Vec<ChatSession> {
        let dir = self.store.dir().join("chats");
        let mut out: Vec<ChatSession> = std::fs::read_dir(dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter_map(|e| std::fs::read(e.path()).ok())
                    .filter_map(|d| serde_json::from_slice::<ChatSession>(&d).ok())
                    .collect()
            })
            .unwrap_or_default();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    /// Ask the UI to approve a write; resolves via `ai_resolve_approval`.
    pub async fn request_approval(
        &self,
        session_id: &str,
        description: &str,
        statement: &str,
    ) -> bool {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.agent
            .pending_approvals
            .lock()
            .unwrap()
            .insert(id.clone(), tx);
        self.emit(
            session_id,
            &AgentEvent::ApprovalRequest {
                id: id.clone(),
                description: description.into(),
                statement: statement.into(),
            },
        );
        let approved = tokio::time::timeout(std::time::Duration::from_secs(600), rx).await;
        self.agent.pending_approvals.lock().unwrap().remove(&id);
        matches!(approved, Ok(Ok(true)))
    }
}

fn provider_for(ctx: &Ctx, id: &str) -> Result<LlmProvider> {
    let settings = ctx.store.settings();
    settings
        .providers
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| {
            AppError::Msg("LLM provider not configured. Open Settings → AI providers.".into())
        })
}

/// One user turn: append message, run the model with tools until it stops, persist.
pub async fn run_turn(ctx: Ctx, session_id: String, user_text: String) -> Result<()> {
    let result = run_turn_inner(&ctx, &session_id, user_text).await;
    ctx.agent.running.lock().unwrap().remove(&session_id);
    match result {
        Ok(session) => {
            ctx.emit(&session_id, &AgentEvent::Done { session });
            Ok(())
        }
        Err(e) => {
            ctx.emit(
                &session_id,
                &AgentEvent::Error {
                    message: e.to_string(),
                },
            );
            if let Ok(session) = ctx.load_session(&session_id) {
                ctx.emit(&session_id, &AgentEvent::Done { session });
            }
            Err(e)
        }
    }
}

async fn run_turn_inner(ctx: &Ctx, session_id: &str, user_text: String) -> Result<ChatSession> {
    let mut session = ctx.load_session(session_id)?;
    let provider = provider_for(ctx, &session.provider_id)?;
    if session.messages.is_empty() {
        session.title = user_text
            .chars()
            .take(60)
            .collect::<String>()
            .trim()
            .to_string();
    }
    session.messages.push(Message::new(
        "user",
        vec![Block::Text {
            text: user_text.clone(),
        }],
    ));
    ctx.save_session(&mut session)?;

    let system = tools::system_prompt(ctx, &session).await;
    let is_cli = matches!(provider.kind.as_str(), "claude_cli" | "codex_cli");

    if is_cli {
        let blocks = providers::run_cli(ctx, &provider, &mut session, &system, &user_text).await?;
        session.messages.push(Message::new("assistant", blocks));
        ctx.save_session(&mut session)?;
        return Ok(session);
    }

    let api_key = ctx.store.provider_api_key(&provider.id).unwrap_or_default();
    let conn = ctx.manager.get(&session.connection_id).await?;
    let defs = tools::definitions(conn.config.driver);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?;

    for _round in 0..25 {
        let blocks = providers::stream_api(
            ctx,
            &client,
            &provider,
            &api_key,
            session_id,
            &system,
            &session.messages,
            &defs,
        )
        .await?;
        let calls: Vec<(String, String, Value)> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::ToolUse { id, name, input } => {
                    Some((id.clone(), name.clone(), input.clone()))
                }
                _ => None,
            })
            .collect();
        session.messages.push(Message::new("assistant", blocks));
        ctx.save_session(&mut session)?;
        if calls.is_empty() {
            break;
        }
        let mut results = vec![];
        for (id, name, input) in calls {
            ctx.emit(
                session_id,
                &AgentEvent::ToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                },
            );
            let out = tools::execute(ctx, &session, &name, &input).await;
            ctx.emit(
                session_id,
                &AgentEvent::ToolResult {
                    id: id.clone(),
                    content: out.content.clone(),
                    is_error: out.is_error,
                    display: out.display.clone(),
                },
            );
            results.push(Block::ToolResult {
                tool_use_id: id,
                content: out.content,
                is_error: out.is_error,
                display: out.display,
            });
        }
        session.messages.push(Message::new("user", results));
        ctx.save_session(&mut session)?;
    }
    Ok(session)
}
