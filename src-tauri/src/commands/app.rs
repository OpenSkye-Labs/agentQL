//! Settings, key-value store, the assistant and the updater.

use super::*;

// ----------------------------------------------------------------- settings / kv

#[tauri::command]
pub fn get_settings(st: State<'_, AppState>) -> Settings {
    st.store.settings()
}

#[tauri::command]
pub fn save_settings(st: State<'_, AppState>, settings: Settings) -> Result<()> {
    st.store.save_settings(&settings)
}

#[tauri::command]
pub fn set_provider_key(
    st: State<'_, AppState>,
    provider_id: String,
    key: Option<String>,
) -> Result<()> {
    st.store
        .set_provider_api_key(&provider_id, key.as_deref().filter(|k| !k.is_empty()))
}

#[tauri::command]
pub fn has_provider_key(st: State<'_, AppState>, provider_id: String) -> bool {
    st.store
        .provider_api_key(&provider_id)
        .is_some_and(|k| !k.is_empty())
}

/// "dark" / "light" when the OS preference is known natively, `None` to use the WebView's media query.
#[tauri::command]
pub async fn system_theme() -> Result<Option<&'static str>> {
    blocking(|| Ok(crate::os_theme::detect())).await
}

#[tauri::command]
pub fn detect_clis() -> Value {
    json!({ "claude": ai::providers::which("claude"), "codex": ai::providers::which("codex") })
}

/// Generic JSON document storage for UI-owned data (dashboards, saved queries, history).
#[tauri::command]
pub fn kv_get(st: State<'_, AppState>, name: String) -> Value {
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Value::Null;
    }
    st.store.read::<Value>(&format!("{name}.json"))
}

#[tauri::command]
pub fn kv_set(st: State<'_, AppState>, name: String, value: Value) -> Result<()> {
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::Msg("invalid store name".into()));
    }
    st.store.write(&format!("{name}.json"), &value)
}

/// Update only the agent scope of a connection, so a stale config in the UI cannot clobber
/// other fields (e.g. a consent granted meanwhile).
#[tauri::command]
pub fn set_agent_scope(
    st: State<'_, AppState>,
    id: String,
    scope: Option<Vec<crate::config::ScopeEntry>>,
) -> Result<()> {
    let mut list = st.store.connections();
    let conn = list
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::Msg("connection not found".into()))?;
    conn.agent_scope = scope;
    conn.updated_at = Some(chrono::Utc::now().to_rfc3339());
    st.store.save_connections(&list)
}

/// The connection's data-dictionary notes (`notes.json`).
#[tauri::command]
pub async fn notes_list(st: State<'_, AppState>, connection_id: String) -> Result<Vec<Note>> {
    let store = st.store.clone();
    blocking(move || store.notes(&connection_id)).await
}

/// Insert or replace one note; blank text deletes it. Open tabs refresh on `notes:changed`.
#[tauri::command]
pub async fn note_save(
    app: AppHandle,
    st: State<'_, AppState>,
    connection_id: String,
    note: Note,
) -> Result<()> {
    let store = st.store.clone();
    let id = connection_id.clone();
    blocking(move || store.save_note(&id, note)).await?;
    let _ = app.emit("notes:changed", &connection_id);
    Ok(())
}

/// Prepend one query-history entry (the UI's own runs); agent runs go through the same store call.
#[tauri::command]
pub fn history_add(st: State<'_, AppState>, entry: Value) -> Result<()> {
    st.store.push_history(entry)
}

// ----------------------------------------------------------------- ai

#[tauri::command]
pub fn ai_list_sessions(
    app: AppHandle,
    st: State<'_, AppState>,
    connection_id: Option<String>,
) -> Vec<ChatSession> {
    ctx(&app, &st)
        .list_sessions()
        .into_iter()
        .filter(|s| connection_id.as_ref().is_none_or(|c| &s.connection_id == c))
        .map(|mut s| {
            s.messages.clear();
            s
        })
        .collect()
}

#[tauri::command]
pub fn ai_get_session(app: AppHandle, st: State<'_, AppState>, id: String) -> Result<ChatSession> {
    ctx(&app, &st).load_session(&id)
}

#[tauri::command]
pub fn ai_create_session(
    app: AppHandle,
    st: State<'_, AppState>,
    connection_id: String,
    provider_id: String,
) -> Result<ChatSession> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut s = ChatSession {
        id: uuid::Uuid::new_v4().to_string(),
        connection_id,
        provider_id,
        title: "New chat".into(),
        created_at: now.clone(),
        updated_at: now,
        ..Default::default()
    };
    ctx(&app, &st).save_session(&mut s)?;
    Ok(s)
}

#[tauri::command]
pub fn ai_delete_session(st: State<'_, AppState>, id: String) -> Result<()> {
    let path = st.store.dir().join("chats").join(format!("{id}.json"));
    std::fs::remove_file(path).ok();
    Ok(())
}

#[tauri::command]
pub fn ai_set_session_provider(
    app: AppHandle,
    st: State<'_, AppState>,
    id: String,
    provider_id: String,
) -> Result<()> {
    let c = ctx(&app, &st);
    let mut s = c.load_session(&id)?;
    if s.provider_id != provider_id {
        s.provider_id = provider_id;
        s.cli_session_id = None;
    }
    c.save_session(&mut s)
}

#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    st: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<()> {
    let c = ctx(&app, &st);
    if c.agent.running.lock().unwrap().contains_key(&session_id) {
        return Err(AppError::Msg(
            "the agent is still working on the previous message".into(),
        ));
    }
    let sid = session_id.clone();
    let handle = tokio::spawn(async move {
        let _ = ai::run_turn(c, sid, text).await;
    });
    st.agent
        .running
        .lock()
        .unwrap()
        .insert(session_id, handle.abort_handle());
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, st: State<'_, AppState>, session_id: String) -> Result<()> {
    if let Some(h) = st.agent.running.lock().unwrap().remove(&session_id) {
        h.abort();
    }
    let c = ctx(&app, &st);
    c.emit(
        &session_id,
        &AgentEvent::Error {
            message: "cancelled".into(),
        },
    );
    if let Ok(s) = c.load_session(&session_id) {
        c.emit(&session_id, &AgentEvent::Done { session: s });
    }
    Ok(())
}

#[tauri::command]
pub fn ai_resolve_approval(st: State<'_, AppState>, id: String, approved: bool) -> Result<()> {
    if let Some(tx) = st.agent.pending_approvals.lock().unwrap().remove(&id) {
        let _ = tx.send(approved);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ChartRequest {
    pub connection_id: String,
    pub source: Value,
}

#[tauri::command]
pub async fn run_chart(
    app: AppHandle,
    st: State<'_, AppState>,
    req: ChartRequest,
) -> Result<QueryResult> {
    let c = ctx(&app, &st);
    ai::tools::run_chart_source(&c, &req.connection_id, &req.source, None).await
}

#[tauri::command]
pub fn app_info(st: State<'_, AppState>) -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "data_dir": st.store.dir().to_string_lossy(),
        "mcp_port": st.agent.mcp_port.get(),
        "secret_storage": st.store.secret_storage(),
    })
}

// ----------------------------------------------------------------- Updater

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
    use tauri_plugin_updater::UpdaterExt as _;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        notes: u.body,
    }))
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    use tauri_plugin_updater::UpdaterExt as _;
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
