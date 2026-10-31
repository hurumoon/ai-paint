use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::app_window::ensure_main_window;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelConfig {
    pub model: String,
    pub max_tokens: u32,
}

#[derive(Clone, Copy)]
pub enum ClaudeTask {
    CanvasAnalysis,
    Chat,
    ChallengeScoring,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelSettings {
    canvas_analysis: ClaudeModelConfig,
    chat: ClaudeModelConfig,
    challenge_scoring: ClaudeModelConfig,
}

#[derive(Default)]
pub struct ClaudeModelSettingsState {
    value: Mutex<Option<ClaudeModelSettings>>,
}

const CLAUDE_SONNET_MODEL: &str = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS: u32 = 2048;
const MAX_ALLOWED_TOKENS: u32 = 64000;
const SETTINGS_FILE_NAME: &str = "claude-model-settings.json";

impl Default for ClaudeModelConfig {
    fn default() -> Self {
        Self {
            model: CLAUDE_SONNET_MODEL.to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }
}

impl Default for ClaudeModelSettings {
    fn default() -> Self {
        let default_config = ClaudeModelConfig::default();
        Self {
            canvas_analysis: default_config.clone(),
            chat: default_config.clone(),
            challenge_scoring: default_config,
        }
    }
}

impl ClaudeModelConfig {
    fn normalized(self) -> Self {
        let default_config = Self::default();
        let model = self.model.trim();
        Self {
            model: if model.is_empty() {
                default_config.model
            } else {
                model.to_string()
            },
            max_tokens: if self.max_tokens == 0 {
                default_config.max_tokens
            } else {
                self.max_tokens.min(MAX_ALLOWED_TOKENS)
            },
        }
    }
}

impl ClaudeModelSettings {
    fn normalized(self) -> Self {
        Self {
            canvas_analysis: self.canvas_analysis.normalized(),
            chat: self.chat.normalized(),
            challenge_scoring: self.challenge_scoring.normalized(),
        }
    }

    pub fn config_for_task(&self, task: ClaudeTask) -> ClaudeModelConfig {
        match task {
            ClaudeTask::CanvasAnalysis => self.canvas_analysis.clone(),
            ClaudeTask::Chat => self.chat.clone(),
            ClaudeTask::ChallengeScoring => self.challenge_scoring.clone(),
        }
    }
}

impl ClaudeTask {
    pub fn from_wire_value(value: &str) -> Option<Self> {
        match value {
            "canvasAnalysis" => Some(Self::CanvasAnalysis),
            "chat" => Some(Self::Chat),
            "challengeScoring" => Some(Self::ChallengeScoring),
            _ => None,
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("AIモデル設定フォルダーを確認できません: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("AIモデル設定フォルダーを作成できません: {}", e))?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn temp_path_for_settings_write(path: &Path, attempt: u32) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| "AIモデル設定ファイル名を確認できません".to_string())?
        .to_string_lossy();
    let parent = path
        .parent()
        .ok_or_else(|| "AIモデル設定フォルダーを確認できません".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Ok(parent.join(format!(
        "{file_name}.tmp-{}-{timestamp}-{attempt}",
        std::process::id()
    )))
}

fn create_settings_temp_file(path: &Path) -> Result<(File, PathBuf), String> {
    for attempt in 0..100 {
        let temp_path = temp_path_for_settings_write(path, attempt)?;
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((file, temp_path)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!(
                    "AIモデル設定の一時ファイルを作成できません: {}",
                    err
                ));
            }
        }
    }
    Err("AIモデル設定の一時ファイル名を確保できません".to_string())
}

#[cfg(windows)]
fn persist_settings_temp_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    if path.exists() {
        replace_existing_file(path, temp_path)
    } else {
        fs::rename(temp_path, path)
    }
}

#[cfg(windows)]
fn replace_existing_file(path: &Path, temp_path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    let path_wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temp_path_wide: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            path_wide.as_ptr(),
            temp_path_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn persist_settings_temp_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temp_path, path)
}

#[cfg(unix)]
fn best_effort_sync_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = File::open(parent).and_then(|file| file.sync_all());
    }
}

#[cfg(not(unix))]
fn best_effort_sync_parent(_path: &Path) {}

fn remove_temp_settings_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn write_settings_file_atomically(path: &Path, raw: &str) -> Result<(), String> {
    let (mut file, temp_path) = create_settings_temp_file(path)?;

    if let Err(err) = file.write_all(raw.as_bytes()) {
        drop(file);
        remove_temp_settings_file(&temp_path);
        return Err(format!("AIモデル設定を保存できません: {}", err));
    }
    if let Err(err) = file.sync_all() {
        drop(file);
        remove_temp_settings_file(&temp_path);
        return Err(format!("AIモデル設定を保存できません: {}", err));
    }
    drop(file);

    if let Err(err) = persist_settings_temp_file(&temp_path, path) {
        remove_temp_settings_file(&temp_path);
        return Err(format!("AIモデル設定を保存できません: {}", err));
    }
    best_effort_sync_parent(path);
    Ok(())
}

fn read_settings_from_disk(app: &tauri::AppHandle) -> ClaudeModelSettings {
    let Ok(path) = settings_path(app) else {
        return ClaudeModelSettings::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return ClaudeModelSettings::default();
    };
    serde_json::from_str::<ClaudeModelSettings>(&raw)
        .map(ClaudeModelSettings::normalized)
        .unwrap_or_default()
}

fn write_settings_to_disk(
    app: &tauri::AppHandle,
    settings: &ClaudeModelSettings,
) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("AIモデル設定を書き出せません: {}", e))?;
    write_settings_file_atomically(&path, &raw)
}

pub fn current_model_settings(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, ClaudeModelSettingsState>,
) -> Result<ClaudeModelSettings, String> {
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "AIモデル設定を確認できません".to_string())?;
    if let Some(settings) = guard.as_ref() {
        return Ok(settings.clone());
    }
    let settings = read_settings_from_disk(app);
    *guard = Some(settings.clone());
    Ok(settings)
}

pub fn config_for_task(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, ClaudeModelSettingsState>,
    task: ClaudeTask,
) -> Result<ClaudeModelConfig, String> {
    Ok(current_model_settings(app, state)?.config_for_task(task))
}

#[tauri::command]
pub fn get_claude_model_settings(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeModelSettingsState>,
) -> Result<ClaudeModelSettings, String> {
    ensure_main_window(&window)?;
    current_model_settings(&app, &state)
}

#[tauri::command]
pub fn set_claude_model_settings(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeModelSettingsState>,
    settings: ClaudeModelSettings,
) -> Result<ClaudeModelSettings, String> {
    ensure_main_window(&window)?;
    let settings = settings.normalized();
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "AIモデル設定を更新できません".to_string())?;
    // ロック取得の失敗で、保存済みファイルだけが更新される状態を防ぐ。
    write_settings_to_disk(&app, &settings)?;
    *guard = Some(settings.clone());
    Ok(settings)
}

#[tauri::command]
pub fn reset_claude_model_settings(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeModelSettingsState>,
) -> Result<ClaudeModelSettings, String> {
    ensure_main_window(&window)?;
    let settings = ClaudeModelSettings::default();
    write_settings_to_disk(&app, &settings)?;
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "AIモデル設定を更新できません".to_string())?;
    *guard = Some(settings.clone());
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_empty_model_and_zero_tokens_to_defaults() {
        let settings = ClaudeModelSettings {
            canvas_analysis: ClaudeModelConfig {
                model: "  ".to_string(),
                max_tokens: 0,
            },
            chat: ClaudeModelConfig {
                model: " custom-model ".to_string(),
                max_tokens: 1234,
            },
            challenge_scoring: ClaudeModelConfig {
                model: "score-model".to_string(),
                max_tokens: MAX_ALLOWED_TOKENS + 1,
            },
        }
        .normalized();

        assert_eq!(settings.canvas_analysis, ClaudeModelConfig::default());
        assert_eq!(settings.chat.model, "custom-model");
        assert_eq!(settings.chat.max_tokens, 1234);
        assert_eq!(settings.challenge_scoring.model, "score-model");
        assert_eq!(settings.challenge_scoring.max_tokens, MAX_ALLOWED_TOKENS);
    }

    #[test]
    fn returns_task_specific_config() {
        let settings = ClaudeModelSettings {
            canvas_analysis: ClaudeModelConfig {
                model: "analysis".to_string(),
                max_tokens: 100,
            },
            chat: ClaudeModelConfig {
                model: "chat".to_string(),
                max_tokens: 200,
            },
            challenge_scoring: ClaudeModelConfig {
                model: "score".to_string(),
                max_tokens: 300,
            },
        };

        assert_eq!(
            settings.config_for_task(ClaudeTask::CanvasAnalysis).model,
            "analysis"
        );
        assert_eq!(settings.config_for_task(ClaudeTask::Chat).model, "chat");
        assert_eq!(
            settings.config_for_task(ClaudeTask::ChallengeScoring).model,
            "score"
        );
    }

    #[test]
    fn atomic_settings_write_replaces_existing_file_and_removes_temp() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ai-paint-model-settings-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join(SETTINGS_FILE_NAME);
        fs::write(&path, "old-settings").expect("old settings should be written");

        write_settings_file_atomically(&path, "new-settings")
            .expect("settings should be written atomically");

        assert_eq!(
            fs::read_to_string(&path).expect("settings should be readable"),
            "new-settings"
        );
        let temp_files = fs::read_dir(&dir)
            .expect("temp dir should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(temp_files, 0);

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }
}
