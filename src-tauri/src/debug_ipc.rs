use std::{env, fs, path::PathBuf};

use serde::Serialize;

use crate::app_window::ensure_main_window;

const MAX_DEBUG_IPC_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;
const REPORT_PATH_ENV: &str = "AI_PAINT_TAURI_IPC_REPORT_PATH";

#[derive(Serialize)]
pub struct DebugIpcPingResult {
    payload_bytes: usize,
    response_bytes: usize,
}

fn request_raw_bytes<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => {
            Err("IPC 計測用コマンドにはバイナリ本文を渡してください".to_string())
        }
    }
}

fn clamp_debug_payload_bytes(bytes: usize) -> usize {
    bytes.min(MAX_DEBUG_IPC_PAYLOAD_BYTES)
}

#[tauri::command]
pub fn debug_ipc_json_echo(window: tauri::Window, payload: String) -> Result<String, String> {
    ensure_main_window(&window)?;
    Ok(payload
        .as_bytes()
        .get(..clamp_debug_payload_bytes(payload.len()))
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
pub fn debug_ipc_raw_sink(
    window: tauri::Window,
    request: tauri::ipc::Request<'_>,
) -> Result<DebugIpcPingResult, String> {
    ensure_main_window(&window)?;
    let bytes = request_raw_bytes(&request)?.len();
    Ok(DebugIpcPingResult {
        payload_bytes: bytes,
        response_bytes: 0,
    })
}

#[tauri::command]
pub fn debug_ipc_raw_roundtrip(
    window: tauri::Window,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    ensure_main_window(&window)?;
    let bytes = request_raw_bytes(&request)?;
    Ok(tauri::ipc::Response::new(
        bytes[..clamp_debug_payload_bytes(bytes.len())].to_vec(),
    ))
}

#[tauri::command]
pub fn debug_ipc_save_measurement_report(
    window: tauri::Window,
    report: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let path = env::var_os(REPORT_PATH_ENV)
        .map(PathBuf::from)
        .ok_or_else(|| format!("{REPORT_PATH_ENV} が設定されていません"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("IPC 計測結果の保存先を作成できません: {}", e))?;
    }
    fs::write(&path, report).map_err(|e| format!("IPC 計測結果を保存できません: {}", e))
}
