#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_models;
mod ai_models;
mod api_key;
mod app_window;
mod claude;
#[cfg(debug_assertions)]
mod debug_ipc;
mod native_files;
mod smoke_ready;

fn main() {
    let startup_open_paths = native_files::startup_open_paths_from_args();
    let builder = tauri::Builder::default()
        .manage(api_key::ApiKeyState::default())
        .manage(api_key::GptApiKeyState::default())
        .manage(ai_models::ClaudeModelSettingsState::default())
        .manage(native_files::FileAccessState::new(startup_open_paths))
        .plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        native_files::native_begin_open_file,
        native_files::native_take_startup_open_files,
        native_files::native_read_file_chunk,
        native_files::native_finish_read_file,
        native_files::native_cancel_read_file,
        native_files::native_begin_save_file,
        native_files::native_begin_write_file,
        native_files::native_cleanup_atomic_write_temps,
        native_files::native_write_file_chunk,
        native_files::native_finish_write_file,
        native_files::native_cancel_write_file,
        smoke_ready::native_signal_frontend_ready,
        api_key::set_claude_api_key,
        api_key::clear_claude_api_key,
        api_key::has_claude_api_key,
        api_key::set_gpt_api_key,
        api_key::clear_gpt_api_key,
        api_key::has_gpt_api_key,
        ai_models::get_claude_model_settings,
        ai_models::set_claude_model_settings,
        ai_models::reset_claude_model_settings,
        claude::analyze_canvas,
        claude::analyze_canvas_v2,
        claude::chat_with_claude,
        agent_models::request_model,
        debug_ipc::debug_ipc_json_echo,
        debug_ipc::debug_ipc_save_measurement_report,
        debug_ipc::debug_ipc_raw_sink,
        debug_ipc::debug_ipc_raw_roundtrip
    ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        native_files::native_begin_open_file,
        native_files::native_take_startup_open_files,
        native_files::native_read_file_chunk,
        native_files::native_finish_read_file,
        native_files::native_cancel_read_file,
        native_files::native_begin_save_file,
        native_files::native_begin_write_file,
        native_files::native_cleanup_atomic_write_temps,
        native_files::native_write_file_chunk,
        native_files::native_finish_write_file,
        native_files::native_cancel_write_file,
        smoke_ready::native_signal_frontend_ready,
        api_key::set_claude_api_key,
        api_key::clear_claude_api_key,
        api_key::has_claude_api_key,
        api_key::set_gpt_api_key,
        api_key::clear_gpt_api_key,
        api_key::has_gpt_api_key,
        ai_models::get_claude_model_settings,
        ai_models::set_claude_model_settings,
        ai_models::reset_claude_model_settings,
        claude::analyze_canvas,
        claude::analyze_canvas_v2,
        claude::chat_with_claude,
        agent_models::request_model
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
