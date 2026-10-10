pub mod ai;
pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod mcp;
pub mod ssh;

use std::sync::Arc;
use tauri::Manager as _;

pub struct AppState {
    pub store: Arc<config::Store>,
    pub manager: Arc<db::Manager>,
    pub agent: Arc<ai::Agent>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app data dir");
            let state = AppState {
                manager: Arc::new(db::Manager::new(&dir)),
                store: Arc::new(config::Store::new(dir)),
                agent: Arc::new(ai::Agent::default()),
            };
            let ctx = ai::Ctx {
                app: app.handle().clone(),
                manager: state.manager.clone(),
                store: state.store.clone(),
                agent: state.agent.clone(),
            };
            app.manage(state);
            tauri::async_runtime::spawn(async move {
                match mcp::start(ctx.clone()).await {
                    Ok(port) => {
                        let _ = ctx.agent.mcp_port.set(port);
                    }
                    Err(e) => eprintln!("mcp server failed to start: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_update,
            commands::install_update,
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::get_connection_secrets,
            commands::secret_storage,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::connected_connections,
            commands::run_query,
            commands::explain_query,
            commands::list_databases,
            commands::list_schemas,
            commands::list_tables,
            commands::table_details,
            commands::fetch_table,
            commands::count_table,
            commands::preview_changes,
            commands::apply_changes,
            commands::ssh_forget_host,
            commands::export_rows,
            commands::redis_scan,
            commands::redis_get,
            commands::redis_command,
            commands::redis_exec,
            commands::redis_info,
            commands::mongo_collections,
            commands::mongo_find,
            commands::mongo_aggregate,
            commands::mongo_insert,
            commands::mongo_replace,
            commands::mongo_delete,
            commands::mongo_collection_info,
            commands::mongo_command,
            commands::get_settings,
            commands::save_settings,
            commands::set_provider_key,
            commands::has_provider_key,
            commands::detect_clis,
            commands::kv_get,
            commands::kv_set,
            commands::ai_list_sessions,
            commands::ai_get_session,
            commands::ai_create_session,
            commands::ai_delete_session,
            commands::ai_set_session_provider,
            commands::ai_send,
            commands::ai_cancel,
            commands::ai_resolve_approval,
            commands::run_chart,
            commands::app_info,
            commands::read_text_file,
            commands::write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
