use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use serde::Serialize;
use tauri::Manager;

use super::FileAccessState;

const CLEANUP_DIRS_FILE_NAME: &str = "atomic-write-directories.json";
const CLAUDE_SETTINGS_FILE_NAME: &str = "claude-model-settings.json";
const ATOMIC_TEMP_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_TRACKED_DIRS: usize = 128;

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AtomicTempCleanupReport {
    scanned_dirs: usize,
    removed_files: usize,
    skipped_recent_files: usize,
    skipped_current_process_files: usize,
    failed_files: usize,
}

#[derive(Clone)]
struct CleanupDir {
    path: PathBuf,
    allow_settings_temps: bool,
}

fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("一時ファイル掃除用の設定フォルダーを確認できません: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("一時ファイル掃除用の設定フォルダーを作成できません: {}", e))?;
    Ok(dir)
}

fn cleanup_dirs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(CLEANUP_DIRS_FILE_NAME))
}

fn read_tracked_dirs(path: &Path) -> Vec<PathBuf> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn write_tracked_dirs(path: &Path, dirs: &[PathBuf]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(
        &dirs
            .iter()
            .map(|dir| dir.display().to_string())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| format!("一時ファイル掃除用の設定を書き出せません: {}", e))?;
    fs::write(path, raw).map_err(|e| format!("一時ファイル掃除用の設定を保存できません: {}", e))
}

pub(super) fn remember_atomic_write_directory(
    app: &tauri::AppHandle,
    target_path: &Path,
) -> Result<(), String> {
    let Some(parent) = target_path.parent() else {
        return Ok(());
    };
    let Ok(parent) = parent.canonicalize() else {
        return Ok(());
    };
    if !parent.is_dir() {
        return Ok(());
    }

    let dirs_path = cleanup_dirs_path(app)?;
    let mut dirs = read_tracked_dirs(&dirs_path)
        .into_iter()
        .filter_map(|dir| dir.canonicalize().ok())
        .filter(|dir| dir.is_dir())
        .collect::<Vec<_>>();
    dirs.retain(|dir| dir != &parent);
    dirs.insert(0, parent);
    dirs.truncate(MAX_TRACKED_DIRS);
    write_tracked_dirs(&dirs_path, &dirs)
}

fn add_cleanup_dir(
    dirs: &mut Vec<CleanupDir>,
    seen: &mut HashSet<PathBuf>,
    path: PathBuf,
    allow_settings_temps: bool,
) {
    let Ok(path) = path.canonicalize() else {
        return;
    };
    if !path.is_dir() {
        return;
    }
    if let Some(existing) = dirs.iter_mut().find(|dir| dir.path == path) {
        existing.allow_settings_temps |= allow_settings_temps;
        return;
    }
    if seen.insert(path.clone()) {
        dirs.push(CleanupDir {
            path,
            allow_settings_temps,
        });
    }
}

fn cleanup_dirs(
    app: &tauri::AppHandle,
    state: &FileAccessState,
) -> Result<Vec<CleanupDir>, String> {
    let config_dir = app_config_dir(app)?;
    let dirs_path = config_dir.join(CLEANUP_DIRS_FILE_NAME);
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();

    add_cleanup_dir(&mut dirs, &mut seen, config_dir, true);

    for dir in read_tracked_dirs(&dirs_path) {
        add_cleanup_dir(&mut dirs, &mut seen, dir, false);
    }

    if let Ok(paths) = state.startup_open_paths.lock() {
        for path in paths.iter() {
            if let Some(parent) = path.parent() {
                add_cleanup_dir(&mut dirs, &mut seen, parent.to_path_buf(), false);
            }
        }
    }

    Ok(dirs)
}

fn is_numeric(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_digit())
}

fn is_supported_save_target_name(file_name: &str) -> bool {
    let Some(extension) = Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
    else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "aipaint" | "psd" | "png" | "jpg" | "jpeg" | "webp"
    )
}

fn native_write_temp_pid(file_name: &str) -> Option<u32> {
    let (target_name, suffix) = file_name.rsplit_once(".tmp-")?;
    if !is_supported_save_target_name(target_name) {
        return None;
    }
    let parts = suffix.split('-').collect::<Vec<_>>();
    if parts.len() != 6 || parts[1] != "native" || parts[2] != "write" {
        return None;
    }
    let pid = parts[0].parse().ok()?;
    if !is_numeric(parts[3]) || !is_numeric(parts[4]) || !is_numeric(parts[5]) {
        return None;
    }
    Some(pid)
}

fn is_settings_temp(file_name: &str) -> bool {
    let Some(suffix) = file_name.strip_prefix(&format!("{CLAUDE_SETTINGS_FILE_NAME}.tmp-")) else {
        return false;
    };
    let parts = suffix.split('-').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn is_old_enough(path: &Path, now: SystemTime) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let Ok(reference_time) = metadata.created().or_else(|_| metadata.modified()) else {
        return false;
    };
    now.duration_since(reference_time)
        .map(|age| age >= ATOMIC_TEMP_MIN_AGE)
        .unwrap_or(false)
}

fn cleanup_atomic_write_temps_in_dirs<F>(
    dirs: &[CleanupDir],
    current_pid: u32,
    mut should_remove_by_age: F,
) -> AtomicTempCleanupReport
where
    F: FnMut(&Path) -> bool,
{
    let mut report = AtomicTempCleanupReport::default();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir.path) else {
            report.failed_files += 1;
            continue;
        };
        report.scanned_dirs += 1;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                report.failed_files += 1;
                continue;
            };
            if !file_type.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let native_temp_pid = native_write_temp_pid(&file_name);
            let is_target = native_temp_pid.is_some()
                || (dir.allow_settings_temps && is_settings_temp(&file_name));
            if !is_target {
                continue;
            }
            if native_temp_pid == Some(current_pid) {
                report.skipped_current_process_files += 1;
                continue;
            }
            if !should_remove_by_age(&path) {
                report.skipped_recent_files += 1;
                continue;
            }
            match fs::remove_file(&path) {
                Ok(()) => report.removed_files += 1,
                Err(_) => report.failed_files += 1,
            }
        }
    }
    report
}

pub(super) fn cleanup_atomic_write_temps(
    app: &tauri::AppHandle,
    state: &FileAccessState,
) -> Result<AtomicTempCleanupReport, String> {
    let dirs = cleanup_dirs(app, state)?;
    let now = SystemTime::now();
    Ok(cleanup_atomic_write_temps_in_dirs(
        &dirs,
        std::process::id(),
        |path| is_old_enough(path, now),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ai-paint-cleanup-{name}-{unique}"))
    }

    #[test]
    fn native_write_temp_pid_accepts_only_session_temp_names() {
        assert_eq!(
            native_write_temp_pid("image.aipaint.tmp-123-native-write-4-567-0"),
            Some(123)
        );
        assert_eq!(native_write_temp_pid("image.aipaint.tmp-123-567-0"), None);
        assert_eq!(
            native_write_temp_pid("image.aipaint.tmp-x-native-write-4-567-0"),
            None
        );
        assert_eq!(
            native_write_temp_pid("image.aipaint.tmp-123-native-read-4-567-0"),
            None
        );
    }

    #[test]
    fn cleanup_removes_only_old_target_temp_files() {
        let dir = temp_dir("old-targets");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let old_temp = dir.join("image.aipaint.tmp-123-native-write-4-567-0");
        let recent_temp = dir.join("other.aipaint.tmp-124-native-write-5-568-0");
        let unrelated = dir.join("notes.txt.tmp-123-native-write-4-567-0.bak");
        fs::write(&old_temp, b"old").expect("old temp should be written");
        fs::write(&recent_temp, b"recent").expect("recent temp should be written");
        fs::write(&unrelated, b"unrelated").expect("unrelated temp should be written");
        let dirs = vec![CleanupDir {
            path: dir.clone(),
            allow_settings_temps: false,
        }];

        let report = cleanup_atomic_write_temps_in_dirs(&dirs, 999, |path| path == old_temp);

        assert_eq!(report.removed_files, 1);
        assert_eq!(report.skipped_recent_files, 1);
        assert!(!old_temp.exists());
        assert!(recent_temp.exists());
        assert!(unrelated.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_skips_current_process_native_temp_files() {
        let dir = temp_dir("current-process");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let current_temp = dir.join("image.aipaint.tmp-321-native-write-4-567-0");
        fs::write(&current_temp, b"current").expect("current temp should be written");
        let dirs = vec![CleanupDir {
            path: dir.clone(),
            allow_settings_temps: false,
        }];

        let report = cleanup_atomic_write_temps_in_dirs(&dirs, 321, |_| true);

        assert_eq!(report.removed_files, 0);
        assert_eq!(report.skipped_current_process_files, 1);
        assert!(current_temp.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_temps_are_only_allowed_in_settings_cleanup_dirs() {
        let dir = temp_dir("settings-temp");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let settings_temp = dir.join("claude-model-settings.json.tmp-123-456-0");
        fs::write(&settings_temp, b"settings").expect("settings temp should be written");

        let disallowed = vec![CleanupDir {
            path: dir.clone(),
            allow_settings_temps: false,
        }];
        let report = cleanup_atomic_write_temps_in_dirs(&disallowed, 999, |_| true);
        assert_eq!(report.removed_files, 0);
        assert!(settings_temp.exists());

        let allowed = vec![CleanupDir {
            path: dir.clone(),
            allow_settings_temps: true,
        }];
        let report = cleanup_atomic_write_temps_in_dirs(&allowed, 999, |_| true);
        assert_eq!(report.removed_files, 1);
        assert!(!settings_temp.exists());
        let _ = fs::remove_dir_all(dir);
    }
}
