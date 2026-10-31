use std::path::{Path, PathBuf};

use super::FileAccessState;

pub(super) fn normalize_user_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|e| format!("ファイルパスを確認できません: {}", e));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| "ファイル名を確認できません".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "保存先フォルダーを確認できません".to_string())?;
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("保存先フォルダーを確認できません: {}", e))?;
    Ok(parent.join(file_name))
}

pub(super) fn register_writable_path(state: &FileAccessState, path: &Path) -> Result<(), String> {
    let normalized = normalize_user_path(path)?;
    let mut guard = state
        .writable_paths
        .lock()
        .map_err(|_| "ファイルアクセス状態を更新できません".to_string())?;
    guard.insert(normalized);
    Ok(())
}

pub(super) fn ensure_writable_path(
    state: &FileAccessState,
    path: &Path,
) -> Result<PathBuf, String> {
    let normalized = normalize_user_path(path)?;
    let guard = state
        .writable_paths
        .lock()
        .map_err(|_| "ファイルアクセス状態を確認できません".to_string())?;
    if guard.contains(&normalized) {
        Ok(normalized)
    } else {
        Err("このパスには保存できません。先に保存ダイアログで保存先を選んでください".to_string())
    }
}

pub(super) fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}
