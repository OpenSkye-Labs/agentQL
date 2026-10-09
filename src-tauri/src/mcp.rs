//! Minimal MCP (Model Context Protocol) streamable-HTTP server so Claude Code
//! and Codex subprocesses can use the app's database tools with the same
//! approval flow as API providers. JSON-RPC over POST /mcp/{session_id}.

use crate::ai::{Ctx, tools};
use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, post},
};
use serde_json::{Value, json};

pub async fn start(ctx: Ctx) -> std::io::Result<u16> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let app = Router::new()
        .route("/mcp/{session_id}", post(handle))
        .route("/mcp/{session_id}", any(other))
        .with_state(ctx);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(port)
}

async fn other() -> Response {
    StatusCode::METHOD_NOT_ALLOWED.into_response()
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}
fn rpc_error(id: Value, code: i64, msg: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": msg}})
}

async fn handle(State(ctx): State<Ctx>, Path(session_id): Path<String>, headers: HeaderMap, body: String) -> Response {
    let auth = headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
    if auth != format!("Bearer {}", ctx.agent.mcp_token) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    let Ok(req) = serde_json::from_str::<Value>(&body) else {
        return (StatusCode::BAD_REQUEST, rpc_error(Value::Null, -32700, "parse error").to_string()).into_response();
    };
    let reqs: Vec<Value> = match req {
        Value::Array(a) => a,
        v => vec![v],
    };
    let mut responses = vec![];
    for r in reqs {
        if let Some(resp) = dispatch(&ctx, &session_id, r).await {
            responses.push(resp);
        }
    }
    if responses.is_empty() {
        return StatusCode::ACCEPTED.into_response();
    }
    let payload = if responses.len() == 1 { responses.remove(0) } else { Value::Array(responses) };
    ([("content-type", "application/json")], payload.to_string()).into_response()
}

async fn dispatch(ctx: &Ctx, session_id: &str, req: Value) -> Option<Value> {
    let method = req["method"].as_str().unwrap_or("");
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    if method.starts_with("notifications/") {
        return None;
    }
    Some(match method {
        "initialize" => rpc_result(
            id,
            json!({
                "protocolVersion": req.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-03-26")),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "agentql", "version": env!("CARGO_PKG_VERSION")}
            }),
        ),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => {
            let driver = match ctx.load_session(session_id) {
                Ok(s) => match ctx.manager.get(&s.connection_id).await {
                    Ok(c) => c.config.driver,
                    Err(_) => return Some(rpc_error(id, -32000, "connection is offline")),
                },
                Err(_) => return Some(rpc_error(id, -32000, "unknown session")),
            };
            let tools: Vec<Value> = tools::definitions(driver)
                .into_iter()
                .map(|t| json!({"name": t.name, "description": t.description, "inputSchema": t.input_schema}))
                .collect();
            rpc_result(id, json!({"tools": tools}))
        }
        "tools/call" => {
            let name = req.pointer("/params/name").and_then(|n| n.as_str()).unwrap_or("");
            let args = req.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            let out = tools::execute_for_mcp(ctx, session_id, name, &args).await;
            rpc_result(id, json!({"content": [{"type": "text", "text": out.content}], "isError": out.is_error}))
        }
        _ => rpc_error(id, -32601, "method not found"),
    })
}
