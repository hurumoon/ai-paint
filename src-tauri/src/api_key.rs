use std::sync::Mutex;

use crate::app_window::ensure_main_window;

#[cfg(not(debug_assertions))]
const API_KEY_SERVICE: &str = "jp.pixelpassion.aipaint";
#[cfg(not(debug_assertions))]
const API_KEY_ACCOUNT: &str = "anthropic-api-key";
#[cfg(not(debug_assertions))]
const GPT_API_KEY_ACCOUNT: &str = "openai-api-key";

#[derive(Default)]
pub struct ApiKeyState {
    value: Mutex<Option<String>>,
}

#[derive(Default)]
pub struct GptApiKeyState {
    value: Mutex<Option<String>>,
}

pub(crate) fn read_api_key(state: &tauri::State<'_, ApiKeyState>) -> Result<String, String> {
    let guard = state
        .value
        .lock()
        .map_err(|_| "API キー状態を取得できません".to_string())?;
    guard
        .as_ref()
        .filter(|key| !key.trim().is_empty())
        .cloned()
        .ok_or_else(|| "API キーを入れてください".to_string())
}

#[cfg(not(debug_assertions))]
fn credential_entry() -> Result<keyring::Entry, String> {
    credential_entry_for(API_KEY_ACCOUNT)
}

#[cfg(not(debug_assertions))]
fn credential_entry_for(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(API_KEY_SERVICE, account)
        .map_err(|e| format!("資格情報ストアを開けません: {}", e))
}

pub(crate) fn read_gpt_api_key(state: &tauri::State<'_, GptApiKeyState>) -> Result<String, String> {
    let guard = state
        .value
        .lock()
        .map_err(|_| "GPT API キー状態を取得できません".to_string())?;
    guard
        .as_ref()
        .filter(|key| !key.trim().is_empty())
        .cloned()
        .ok_or_else(|| "GPT API キーを入れてください".to_string())
}

#[cfg(not(debug_assertions))]
fn load_persisted_gpt_api_key() -> Result<Option<String>, String> {
    match credential_entry_for(GPT_API_KEY_ACCOUNT)?.get_password() {
        Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("保存済み GPT API キーを読み込めません: {}", e)),
    }
}

#[cfg(debug_assertions)]
fn load_persisted_gpt_api_key() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(debug_assertions))]
fn persist_gpt_api_key(key: &str) -> Result<(), String> {
    credential_entry_for(GPT_API_KEY_ACCOUNT)?
        .set_password(key)
        .map_err(|e| format!("GPT API キーを資格情報ストアに保存できません: {}", e))
}

#[cfg(debug_assertions)]
fn persist_gpt_api_key(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(debug_assertions))]
fn clear_persisted_gpt_api_key() -> Result<(), String> {
    match credential_entry_for(GPT_API_KEY_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("保存済み GPT API キーを削除できません: {}", e)),
    }
}

#[cfg(debug_assertions)]
fn clear_persisted_gpt_api_key() -> Result<(), String> {
    Ok(())
}

#[cfg(not(debug_assertions))]
fn load_persisted_api_key() -> Result<Option<String>, String> {
    match credential_entry()?.get_password() {
        Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("保存済み API キーを読み込めません: {}", e)),
    }
}

#[cfg(debug_assertions)]
fn load_persisted_api_key() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(debug_assertions))]
fn persist_api_key(key: &str) -> Result<(), String> {
    credential_entry()?
        .set_password(key)
        .map_err(|e| format!("API キーを資格情報ストアに保存できません: {}", e))
}

#[cfg(debug_assertions)]
fn persist_api_key(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(debug_assertions))]
fn clear_persisted_api_key() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("保存済み API キーを削除できません: {}", e)),
    }
}

#[cfg(debug_assertions)]
fn clear_persisted_api_key() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn set_claude_api_key(
    window: tauri::Window,
    state: tauri::State<'_, ApiKeyState>,
    api_key: String,
) -> Result<bool, String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "API キー状態を更新できません".to_string())?;
    let key = api_key.trim().to_string();
    if key.is_empty() {
        *guard = None;
        clear_persisted_api_key()?;
        Ok(false)
    } else {
        persist_api_key(&key)?;
        *guard = Some(key);
        Ok(true)
    }
}

#[tauri::command]
pub fn clear_claude_api_key(
    window: tauri::Window,
    state: tauri::State<'_, ApiKeyState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "API キー状態を更新できません".to_string())?;
    *guard = None;
    clear_persisted_api_key()?;
    Ok(())
}

#[tauri::command]
pub fn has_claude_api_key(
    window: tauri::Window,
    state: tauri::State<'_, ApiKeyState>,
) -> Result<bool, String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "API キー状態を取得できません".to_string())?;
    if guard.as_ref().is_some_and(|key| !key.trim().is_empty()) {
        return Ok(true);
    }
    if let Some(key) = load_persisted_api_key()? {
        *guard = Some(key);
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub fn set_gpt_api_key(
    window: tauri::Window,
    state: tauri::State<'_, GptApiKeyState>,
    api_key: String,
) -> Result<bool, String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "GPT API キー状態を更新できません".to_string())?;
    let key = api_key.trim().to_string();
    if key.is_empty() {
        *guard = None;
        clear_persisted_gpt_api_key()?;
        Ok(false)
    } else {
        persist_gpt_api_key(&key)?;
        *guard = Some(key);
        Ok(true)
    }
}

#[tauri::command]
pub fn clear_gpt_api_key(
    window: tauri::Window,
    state: tauri::State<'_, GptApiKeyState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "GPT API キー状態を更新できません".to_string())?;
    *guard = None;
    clear_persisted_gpt_api_key()?;
    Ok(())
}

#[tauri::command]
pub fn has_gpt_api_key(
    window: tauri::Window,
    state: tauri::State<'_, GptApiKeyState>,
) -> Result<bool, String> {
    ensure_main_window(&window)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "GPT API キー状態を取得できません".to_string())?;
    if guard.as_ref().is_some_and(|key| !key.trim().is_empty()) {
        return Ok(true);
    }
    if let Some(key) = load_persisted_gpt_api_key()? {
        *guard = Some(key);
        return Ok(true);
    }
    Ok(false)
}
