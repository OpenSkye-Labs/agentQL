//! LLM providers: Anthropic Messages API, OpenAI-compatible chat completions,
//! and the Claude Code / Codex CLIs (which call back into our MCP endpoint).

use super::{AgentEvent, Block, ChatSession, Ctx, Message, ToolDef};
use crate::config::LlmProvider;
use crate::error::{AppError, Result};
use futures::StreamExt;
use serde_json::{Value, json};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

pub async fn stream_api(
    ctx: &Ctx,
    client: &reqwest::Client,
    provider: &LlmProvider,
    api_key: &str,
    session_id: &str,
    system: &str,
    messages: &[Message],
    tools: &[ToolDef],
) -> Result<Vec<Block>> {
    match provider.kind.as_str() {
        "anthropic" => anthropic(ctx, client, provider, api_key, session_id, system, messages, tools).await,
        _ => openai(ctx, client, provider, api_key, session_id, system, messages, tools).await,
    }
}

/// Iterate `data:` payloads of an SSE body. Returns true when a `[DONE]` sentinel was seen.
async fn for_each_sse<F: FnMut(Value)>(resp: reqwest::Response, mut f: F) -> Result<bool> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut done = false;
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk?);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]).trim_end_matches('\r').to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if data == "[DONE]" {
                    done = true;
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    f(v);
                }
            }
        }
    }
    Ok(done)
}

fn parse_tool_args(raw: &str) -> Result<Value> {
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(raw).map_err(|e| AppError::Msg(format!("model returned invalid tool arguments ({e}); please retry")))
}

async fn check(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or(body);
    Err(AppError::Msg(format!("{status}: {}", super::tools::truncate(&msg, 600))))
}

// ----------------------------------------------------------------- Anthropic

async fn anthropic(
    ctx: &Ctx,
    client: &reqwest::Client,
    p: &LlmProvider,
    api_key: &str,
    session_id: &str,
    system: &str,
    messages: &[Message],
    tools: &[ToolDef],
) -> Result<Vec<Block>> {
    let base = p.base_url.clone().filter(|b| !b.is_empty()).unwrap_or_else(|| "https://api.anthropic.com".into());
    let msgs: Vec<Value> = messages
        .iter()
        .map(|m| {
            let content: Vec<Value> = m
                .blocks
                .iter()
                .map(|b| match b {
                    Block::Text { text } => json!({"type": "text", "text": text}),
                    Block::ToolUse { id, name, input } => json!({"type": "tool_use", "id": id, "name": name, "input": input}),
                    Block::ToolResult { tool_use_id, content, is_error, .. } => {
                        json!({"type": "tool_result", "tool_use_id": tool_use_id, "content": content, "is_error": is_error})
                    }
                })
                .collect();
            json!({"role": m.role, "content": content})
        })
        .collect();
    let tool_defs: Vec<Value> = tools.iter().map(|t| json!({"name": t.name, "description": t.description, "input_schema": t.input_schema})).collect();
    let body = json!({
        "model": if p.model.is_empty() { "claude-sonnet-5-5" } else { p.model.as_str() },
        "max_tokens": 8192,
        "system": system,
        "messages": msgs,
        "tools": tool_defs,
        "stream": true,
    });
    let mut req = client
        .post(format!("{}/v1/messages", base.trim_end_matches('/')))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");
    for (k, v) in &p.extra_headers {
        req = req.header(k, v);
    }
    let resp = check(req.json(&body).send().await?).await?;

    let mut blocks: Vec<Block> = vec![];
    let mut json_bufs: std::collections::HashMap<usize, String> = Default::default();
    let mut raw_args: std::collections::HashMap<usize, String> = Default::default();
    let mut error: Option<String> = None;
    let mut completed = false;
    for_each_sse(resp, |ev| match ev["type"].as_str().unwrap_or("") {
        "content_block_start" => {
            let idx = ev["index"].as_u64().unwrap_or(0) as usize;
            let cb = &ev["content_block"];
            while blocks.len() <= idx {
                blocks.push(Block::Text { text: String::new() });
            }
            if cb["type"] == "tool_use" {
                blocks[idx] = Block::ToolUse { id: cb["id"].as_str().unwrap_or("").into(), name: cb["name"].as_str().unwrap_or("").into(), input: json!({}) };
                json_bufs.insert(idx, String::new());
            } else if let Some(t) = cb["text"].as_str() {
                blocks[idx] = Block::Text { text: t.into() };
            }
        }
        "content_block_delta" => {
            let idx = ev["index"].as_u64().unwrap_or(0) as usize;
            let d = &ev["delta"];
            if d["type"] == "text_delta" {
                let t = d["text"].as_str().unwrap_or("");
                if let Some(Block::Text { text }) = blocks.get_mut(idx) {
                    text.push_str(t);
                }
                ctx.emit(session_id, &AgentEvent::TextDelta { text: t.into() });
            } else if d["type"] == "input_json_delta" {
                json_bufs.entry(idx).or_default().push_str(d["partial_json"].as_str().unwrap_or(""));
            }
        }
        "content_block_stop" => {
            let idx = ev["index"].as_u64().unwrap_or(0) as usize;
            if let Some(buf) = json_bufs.remove(&idx) {
                raw_args.insert(idx, buf);
            }
        }
        "message_stop" => completed = true,
        "error" => error = Some(ev["error"]["message"].as_str().unwrap_or("stream error").to_string()),
        _ => {}
    })
    .await?;
    if let Some(e) = error {
        return Err(AppError::Msg(e));
    }
    if !completed {
        return Err(AppError::Msg("the response stream ended before completion; please retry".into()));
    }
    for (idx, raw) in raw_args {
        if let Some(Block::ToolUse { input, .. }) = blocks.get_mut(idx) {
            *input = parse_tool_args(&raw)?;
        }
    }
    blocks.retain(|b| !matches!(b, Block::Text { text } if text.is_empty()));
    Ok(blocks)
}

// ----------------------------------------------------------------- OpenAI-compatible

async fn openai(
    ctx: &Ctx,
    client: &reqwest::Client,
    p: &LlmProvider,
    api_key: &str,
    session_id: &str,
    system: &str,
    messages: &[Message],
    tools: &[ToolDef],
) -> Result<Vec<Block>> {
    let base = p.base_url.clone().filter(|b| !b.is_empty()).unwrap_or_else(|| "https://api.openai.com/v1".into());
    let mut msgs: Vec<Value> = vec![json!({"role": "system", "content": system})];
    for m in messages {
        if m.role == "assistant" {
            let text = m.text();
            let calls: Vec<Value> = m
                .blocks
                .iter()
                .filter_map(|b| match b {
                    Block::ToolUse { id, name, input } => {
                        Some(json!({"id": id, "type": "function", "function": {"name": name, "arguments": input.to_string()}}))
                    }
                    _ => None,
                })
                .collect();
            let mut msg = json!({"role": "assistant", "content": if text.is_empty() { Value::Null } else { Value::String(text) }});
            if !calls.is_empty() {
                msg["tool_calls"] = Value::Array(calls);
            }
            msgs.push(msg);
        } else {
            let mut texts = vec![];
            for b in &m.blocks {
                match b {
                    Block::Text { text } => texts.push(text.clone()),
                    Block::ToolResult { tool_use_id, content, .. } => {
                        msgs.push(json!({"role": "tool", "tool_call_id": tool_use_id, "content": content}))
                    }
                    _ => {}
                }
            }
            if !texts.is_empty() {
                msgs.push(json!({"role": "user", "content": texts.join("\n")}));
            }
        }
    }
    let tool_defs: Vec<Value> = tools
        .iter()
        .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}}))
        .collect();
    let mut body = json!({
        "model": if p.model.is_empty() { "gpt-5" } else { p.model.as_str() },
        "messages": msgs,
        "stream": true,
    });
    if !tool_defs.is_empty() {
        body["tools"] = Value::Array(tool_defs);
    }
    let mut req = client.post(format!("{}/chat/completions", base.trim_end_matches('/'))).header("content-type", "application/json");
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }
    for (k, v) in &p.extra_headers {
        req = req.header(k, v);
    }
    let resp = check(req.json(&body).send().await?).await?;

    let mut text = String::new();
    let mut calls: Vec<(String, String, String)> = vec![]; // id, name, args
    let mut error: Option<String> = None;
    let mut finished = false;
    let done = for_each_sse(resp, |ev| {
        if let Some(e) = ev.get("error") {
            error = Some(e["message"].as_str().unwrap_or("stream error").to_string());
            return;
        }
        if ev.pointer("/choices/0/finish_reason").is_some_and(|f| !f.is_null()) {
            finished = true;
        }
        let Some(delta) = ev.pointer("/choices/0/delta") else { return };
        if let Some(t) = delta["content"].as_str() {
            if !t.is_empty() {
                text.push_str(t);
                ctx.emit(session_id, &AgentEvent::TextDelta { text: t.into() });
            }
        }
        if let Some(tcs) = delta["tool_calls"].as_array() {
            for tc in tcs {
                let idx = tc["index"].as_u64().unwrap_or(calls.len() as u64) as usize;
                while calls.len() <= idx {
                    calls.push((String::new(), String::new(), String::new()));
                }
                if let Some(id) = tc["id"].as_str() {
                    calls[idx].0 = id.into();
                }
                if let Some(n) = tc["function"]["name"].as_str() {
                    calls[idx].1.push_str(n);
                }
                if let Some(a) = tc["function"]["arguments"].as_str() {
                    calls[idx].2.push_str(a);
                }
            }
        }
    })
    .await?;
    if let Some(e) = error {
        return Err(AppError::Msg(e));
    }
    if !finished && !done {
        return Err(AppError::Msg("the response stream ended before completion; please retry".into()));
    }
    let mut blocks = vec![];
    if !text.is_empty() {
        blocks.push(Block::Text { text });
    }
    for (id, name, args) in calls {
        let id = if id.is_empty() { format!("call_{}", uuid::Uuid::new_v4().simple()) } else { id };
        blocks.push(Block::ToolUse { id, name, input: parse_tool_args(&args)? });
    }
    Ok(blocks)
}

// ----------------------------------------------------------------- CLI providers

fn mcp_url(ctx: &Ctx, session_id: &str) -> Result<String> {
    let port = ctx.agent.mcp_port.get().ok_or_else(|| AppError::Msg("MCP endpoint not running".into()))?;
    Ok(format!("http://127.0.0.1:{port}/mcp/{session_id}"))
}

pub fn which(cmd: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<&str> = if cfg!(windows) { vec![".exe", ".cmd", ".bat", ""] } else { vec![""] };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let p = dir.join(format!("{cmd}{ext}"));
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

pub async fn run_cli(ctx: &Ctx, p: &LlmProvider, session: &mut ChatSession, system: &str, user_text: &str) -> Result<Vec<Block>> {
    let url = mcp_url(ctx, &session.id)?;
    let token = ctx.agent.mcp_token.clone();
    let first_turn = session.cli_session_id.is_none();
    // CLIs own their conversation; we only give them the schema context once.
    let prompt = if first_turn { format!("<context>\n{system}\n</context>\n\n{user_text}") } else { user_text.to_string() };
    let workdir = ctx.store.dir().join("agent-workdir");
    std::fs::create_dir_all(&workdir).ok();

    let mut cmd = match p.kind.as_str() {
        "claude_cli" => {
            let bin = p.command.clone().filter(|c| !c.is_empty()).or_else(|| which("claude")).ok_or_else(|| AppError::Msg("claude CLI not found on PATH".into()))?;
            let mcp = json!({"mcpServers": {"agentql": {"type": "http", "url": url, "headers": {"Authorization": format!("Bearer {token}")}}}});
            let mut c = tokio::process::Command::new(bin);
            c.args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
                .args(["--mcp-config", &mcp.to_string(), "--strict-mcp-config"])
                .args(["--allowedTools", "mcp__agentql__*", "--tools", ""])
                .args(["--permission-mode", "default"]);
            if !p.model.is_empty() {
                c.args(["--model", &p.model]);
            }
            if let Some(id) = &session.cli_session_id {
                c.args(["--resume", id]);
            }
            c.arg(&prompt);
            c
        }
        _ => {
            let bin = p.command.clone().filter(|c| !c.is_empty()).or_else(|| which("codex")).ok_or_else(|| AppError::Msg("codex CLI not found on PATH".into()))?;
            let mut c = tokio::process::Command::new(bin);
            c.arg("exec");
            if let Some(id) = &session.cli_session_id {
                c.args(["resume", id]);
            }
            c.args(["--json", "--skip-git-repo-check", "--sandbox", "read-only"])
                .args(["-c", &format!("mcp_servers.agentql.url=\"{url}\"")])
                .args(["-c", "mcp_servers.agentql.bearer_token_env_var=\"AGENTQL_MCP_TOKEN\""])
                .env("AGENTQL_MCP_TOKEN", &token);
            if !p.model.is_empty() {
                c.args(["-m", &p.model]);
            }
            c.arg(&prompt);
            c
        }
    };
    cmd.current_dir(&workdir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| AppError::Msg(format!("failed to start {}: {e}", p.kind)))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            s.push_str(&l);
            s.push('\n');
        }
        s
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut text = String::new();
    let mut got_delta = false;
    let mut failure: Option<String> = None;
    let mut cli_id = session.cli_session_id.clone();
    let is_claude = p.kind == "claude_cli";
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
        if is_claude {
            match ev["type"].as_str().unwrap_or("") {
                "system" => {
                    if let Some(id) = ev["session_id"].as_str() {
                        cli_id = Some(id.into());
                    }
                }
                "stream_event" => {
                    if ev.pointer("/event/delta/type") == Some(&json!("text_delta")) {
                        let t = ev.pointer("/event/delta/text").and_then(|t| t.as_str()).unwrap_or("");
                        got_delta = true;
                        text.push_str(t);
                        ctx.emit(&session.id, &AgentEvent::TextDelta { text: t.into() });
                    }
                }
                "assistant" => {
                    if !got_delta {
                        if let Some(content) = ev.pointer("/message/content").and_then(|c| c.as_array()) {
                            for b in content {
                                if let Some(t) = b["text"].as_str() {
                                    text.push_str(t);
                                    text.push_str("\n\n");
                                    ctx.emit(&session.id, &AgentEvent::TextDelta { text: format!("{t}\n\n") });
                                }
                            }
                        }
                    }
                    got_delta = false;
                }
                "result" => {
                    if let Some(id) = ev["session_id"].as_str() {
                        cli_id = Some(id.into());
                    }
                    if ev["is_error"].as_bool().unwrap_or(false) {
                        failure = Some(ev["result"].as_str().unwrap_or("claude failed").to_string());
                    }
                }
                _ => {}
            }
        } else {
            match ev["type"].as_str().unwrap_or("") {
                "thread.started" => {
                    if let Some(id) = ev["thread_id"].as_str() {
                        cli_id = Some(id.into());
                    }
                }
                "item.completed" => {
                    let item = &ev["item"];
                    match item["type"].as_str().unwrap_or("") {
                        "agent_message" => {
                            let t = item["text"].as_str().unwrap_or("");
                            text.push_str(t);
                            text.push_str("\n\n");
                            ctx.emit(&session.id, &AgentEvent::TextDelta { text: format!("{t}\n\n") });
                        }
                        "reasoning" => {
                            if let Some(t) = item["text"].as_str() {
                                ctx.emit(&session.id, &AgentEvent::Status { text: super::tools::truncate(t, 200) });
                            }
                        }
                        _ => {}
                    }
                }
                "error" | "turn.failed" => {
                    failure = Some(ev["message"].as_str().or(ev.pointer("/error/message").and_then(|m| m.as_str())).unwrap_or("codex failed").to_string());
                }
                _ => {}
            }
        }
    }
    let status = child.wait().await?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    session.cli_session_id = cli_id;
    if let Some(f) = failure {
        return Err(AppError::Msg(f));
    }
    if !status.success() {
        return Err(AppError::Msg(format!("{} exited with {}: {}", p.kind, status, super::tools::truncate(stderr_text.trim(), 800))));
    }
    // Tool calls made through MCP were already persisted by execute_for_mcp; reload them.
    if let Ok(fresh) = ctx.load_session(&session.id) {
        session.messages = fresh.messages;
    }
    Ok(vec![Block::Text { text: text.trim_end().to_string() }])
}
