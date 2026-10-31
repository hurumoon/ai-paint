use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    sync::{atomic::AtomicU64, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

use crate::app_window::ensure_main_window;

mod cleanup;
mod paths;
mod sessions;

use cleanup::{
    cleanup_atomic_write_temps, remember_atomic_write_directory, AtomicTempCleanupReport,
};
use paths::{ensure_writable_path, file_name, normalize_user_path, register_writable_path};
use sessions::{
    begin_read_session, begin_write_session, cancel_read_session, cancel_write_session,
    finish_read_session, finish_write_session, read_file_chunk_from_session,
    write_file_chunk_to_session,
};

const NATIVE_WRITE_ID_HEADER: &str = "x-ai-paint-write-id";

pub struct FileAccessState {
    pub(in crate::native_files) writable_paths: Mutex<HashSet<PathBuf>>,
    startup_open_paths: Mutex<Vec<PathBuf>>,
    pub(in crate::native_files) read_sessions:
        tokio::sync::Mutex<HashMap<String, sessions::NativeReadSession>>,
    pub(in crate::native_files) write_sessions:
        tokio::sync::Mutex<HashMap<String, sessions::NativeWriteSession>>,
    pub(in crate::native_files) next_read_id: AtomicU64,
    pub(in crate::native_files) next_write_id: AtomicU64,
}

impl FileAccessState {
    pub fn new(startup_open_paths: Vec<PathBuf>) -> Self {
        Self {
            writable_paths: Mutex::new(HashSet::new()),
            startup_open_paths: Mutex::new(startup_open_paths),
            read_sessions: tokio::sync::Mutex::new(HashMap::new()),
            write_sessions: tokio::sync::Mutex::new(HashMap::new()),
            next_read_id: AtomicU64::new(1),
            next_write_id: AtomicU64::new(1),
        }
    }
}

impl Default for FileAccessState {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

#[derive(Deserialize)]
pub struct NativeFileFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Serialize)]
pub struct NativeBeginOpenResult {
    cancelled: bool,
    file_name: Option<String>,
    path: Option<String>,
    read_id: Option<String>,
    file_size: Option<u64>,
    header_bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct NativeBeginSaveResult {
    cancelled: bool,
    file_name: Option<String>,
    path: Option<String>,
    write_id: Option<String>,
}

#[derive(Serialize)]
pub struct NativeBeginWriteResult {
    write_id: String,
}

fn apply_file_filters<R: tauri::Runtime>(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: &[NativeFileFilter],
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for filter in filters {
        let extensions: Vec<&str> = filter
            .extensions
            .iter()
            .map(|ext| ext.trim().trim_start_matches('.'))
            .filter(|ext| !ext.is_empty())
            .collect();
        if !filter.name.trim().is_empty() && !extensions.is_empty() {
            dialog = dialog.add_filter(filter.name.trim(), &extensions);
        }
    }
    dialog
}

fn allowed_save_extensions(filter: &NativeFileFilter) -> Vec<String> {
    filter
        .extensions
        .iter()
        .map(|ext| ext.trim().trim_start_matches('.'))
        .filter(|ext| !ext.is_empty() && *ext != "*")
        .map(|ext| ext.to_ascii_lowercase())
        .collect()
}

fn enforce_save_extension(path: &Path, filter: &NativeFileFilter) -> PathBuf {
    let extensions = allowed_save_extensions(filter);
    let Some(primary_extension) = extensions.first() else {
        return path.to_path_buf();
    };

    let current_extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    if current_extension.is_some_and(|ext| extensions.iter().any(|allowed| allowed == &ext)) {
        return path.to_path_buf();
    }

    let mut normalized = path.to_path_buf();
    normalized.set_extension(primary_extension);
    normalized
}

fn request_header_string(
    request: &tauri::ipc::Request<'_>,
    name: &str,
    missing_message: &str,
) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| missing_message.to_string())?
        .to_str()
        .map_err(|_| "ファイル処理セッションを確認できません".to_string())?
        .trim()
        .to_string();
    if value.is_empty() {
        Err(missing_message.to_string())
    } else {
        Ok(value)
    }
}

fn request_raw_bytes<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => {
            Err("ファイルデータをバイナリとして受け取れませんでした".to_string())
        }
    }
}

fn is_supported_open_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "aipaint" | "psd" | "png" | "jpg" | "jpeg" | "webp"
            )
        })
        .unwrap_or(false)
}

pub fn startup_open_paths_from<I, P>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: Into<PathBuf>,
{
    args.into_iter()
        .map(Into::into)
        .filter(|path| path.is_file() && is_supported_open_path(path))
        .collect()
}

pub fn startup_open_paths_from_args() -> Vec<PathBuf> {
    startup_open_paths_from(env::args_os().skip(1))
}

async fn begin_open_path(
    state: &FileAccessState,
    path: PathBuf,
) -> Result<NativeBeginOpenResult, String> {
    if !is_supported_open_path(&path) {
        return Err("対応していないファイル形式です".to_string());
    }
    let read_path = path
        .canonicalize()
        .map_err(|e| format!("ファイルパスを確認できません: {}", e))?;
    let session = begin_read_session(state, read_path).await?;
    Ok(NativeBeginOpenResult {
        cancelled: false,
        file_name: Some(file_name(&path)),
        path: Some(path.display().to_string()),
        read_id: Some(session.read_id),
        file_size: Some(session.file_size),
        header_bytes: Some(session.header_bytes),
    })
}

async fn take_startup_open_files(
    state: &FileAccessState,
) -> Result<Vec<NativeBeginOpenResult>, String> {
    let paths = {
        let mut guard = state
            .startup_open_paths
            .lock()
            .map_err(|_| "起動時のファイルパスを確認できません".to_string())?;
        guard.drain(..).collect::<Vec<_>>()
    };

    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        match begin_open_path(state, path).await {
            Ok(result) => results.push(result),
            Err(err) => {
                for result in &results {
                    if let Some(read_id) = &result.read_id {
                        cancel_read_session(state, read_id).await;
                    }
                }
                return Err(err);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn native_begin_open_file(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    filters: Vec<NativeFileFilter>,
) -> Result<NativeBeginOpenResult, String> {
    ensure_main_window(&window)?;
    let dialog = apply_file_filters(window.dialog().file().set_parent(&window), &filters);
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(path) = rx
        .await
        .map_err(|_| "ファイル選択を完了できません".to_string())?
    else {
        return Ok(NativeBeginOpenResult {
            cancelled: true,
            file_name: None,
            path: None,
            read_id: None,
            file_size: None,
            header_bytes: None,
        });
    };
    let path =
        PathBuf::try_from(path).map_err(|e| format!("ファイルパスを確認できません: {}", e))?;
    begin_open_path(&state, path).await
}

#[tauri::command]
pub async fn native_take_startup_open_files(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
) -> Result<Vec<NativeBeginOpenResult>, String> {
    ensure_main_window(&window)?;
    take_startup_open_files(&state).await
}

#[tauri::command]
pub async fn native_read_file_chunk(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    read_id: String,
    max_bytes: usize,
) -> Result<tauri::ipc::Response, String> {
    ensure_main_window(&window)?;
    let chunk = read_file_chunk_from_session(&state, &read_id, max_bytes).await?;
    Ok(tauri::ipc::Response::new(chunk.bytes))
}

#[tauri::command]
pub async fn native_finish_read_file(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    read_id: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let path = finish_read_session(&state, &read_id).await?;
    register_writable_path(&state, &path)
}

#[tauri::command]
pub async fn native_cancel_read_file(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    read_id: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_read_session(&state, &read_id).await;
    Ok(())
}

#[tauri::command]
pub async fn native_begin_save_file(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, FileAccessState>,
    default_name: String,
    filter: NativeFileFilter,
) -> Result<NativeBeginSaveResult, String> {
    ensure_main_window(&window)?;
    let dialog = apply_file_filters(
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(default_name),
        std::slice::from_ref(&filter),
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(path) = rx
        .await
        .map_err(|_| "保存先の選択を完了できません".to_string())?
    else {
        return Ok(NativeBeginSaveResult {
            cancelled: true,
            file_name: None,
            path: None,
            write_id: None,
        });
    };
    let selected_path =
        PathBuf::try_from(path).map_err(|e| format!("ファイルパスを確認できません: {}", e))?;
    let path = enforce_save_extension(&selected_path, &filter);
    let write_path = normalize_user_path(&path)?;
    let _ = remember_atomic_write_directory(&app, &write_path);
    let write_id = begin_write_session(&state, write_path).await?;
    Ok(NativeBeginSaveResult {
        cancelled: false,
        file_name: Some(file_name(&path)),
        path: Some(path.display().to_string()),
        write_id: Some(write_id),
    })
}

#[tauri::command]
pub async fn native_begin_write_file(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, FileAccessState>,
    path: String,
) -> Result<NativeBeginWriteResult, String> {
    ensure_main_window(&window)?;
    let path = ensure_writable_path(&state, Path::new(&path))?;
    let _ = remember_atomic_write_directory(&app, &path);
    let write_id = begin_write_session(&state, path).await?;
    Ok(NativeBeginWriteResult { write_id })
}

#[tauri::command]
pub fn native_cleanup_atomic_write_temps(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, FileAccessState>,
) -> Result<AtomicTempCleanupReport, String> {
    ensure_main_window(&window)?;
    cleanup_atomic_write_temps(&app, &state)
}

#[tauri::command]
pub async fn native_write_file_chunk(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let write_id = request_header_string(
        &request,
        NATIVE_WRITE_ID_HEADER,
        "ファイル処理セッションを開始できませんでした",
    )?;
    let bytes = request_raw_bytes(&request)?;
    write_file_chunk_to_session(&state, &write_id, bytes).await
}

#[tauri::command]
pub async fn native_finish_write_file(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    write_id: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let path = finish_write_session(&state, &write_id).await?;
    register_writable_path(&state, &path)
}

#[tauri::command]
pub async fn native_cancel_write_file(
    window: tauri::Window,
    state: tauri::State<'_, FileAccessState>,
    write_id: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_write_session(&state, &write_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ai-paint-native-files-{name}-{unique}"))
    }

    fn write_temp_files(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .expect("temp dir should be readable")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".tmp-"))
            })
            .collect()
    }

    #[test]
    fn startup_open_paths_from_filters_existing_supported_files() {
        let dir = temp_dir("startup-args-filter");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let supported_aipaint = dir.join("image.aipaint");
        let supported_upper = dir.join("photo.PNG");
        let unsupported_svg = dir.join("vector.svg");
        let unsupported = dir.join("notes.txt");
        let missing_supported = dir.join("missing.psd");
        let directory_with_supported_ext = dir.join("folder.webp");
        fs::write(&supported_aipaint, b"aipaint").expect("aipaint temp file should be written");
        fs::write(&supported_upper, b"png").expect("png temp file should be written");
        fs::write(&unsupported_svg, b"svg").expect("svg temp file should be written");
        fs::write(&unsupported, b"text").expect("text temp file should be written");
        fs::create_dir_all(&directory_with_supported_ext).expect("temp subdir should be created");

        let paths = startup_open_paths_from([
            unsupported,
            unsupported_svg,
            supported_aipaint.clone(),
            missing_supported,
            directory_with_supported_ext,
            supported_upper.clone(),
        ]);

        assert_eq!(paths, vec![supported_aipaint, supported_upper]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn enforce_save_extension_replaces_mismatched_extension() {
        let dir = temp_dir("save-extension-replace");
        let selected_path = dir.join("layered.png");
        let filter = NativeFileFilter {
            name: ".aipaint (レイヤー保持)".to_string(),
            extensions: vec!["aipaint".to_string()],
        };

        let path = enforce_save_extension(&selected_path, &filter);

        assert_eq!(path, dir.join("layered.aipaint"));
    }

    #[test]
    fn enforce_save_extension_keeps_allowed_alternate_extension() {
        let dir = temp_dir("save-extension-keep");
        let selected_path = dir.join("flat.jpeg");
        let filter = NativeFileFilter {
            name: "JPEG".to_string(),
            extensions: vec!["jpg".to_string(), "jpeg".to_string()],
        };

        let path = enforce_save_extension(&selected_path, &filter);

        assert_eq!(path, selected_path);
    }

    #[test]
    fn enforce_save_extension_appends_missing_extension() {
        let dir = temp_dir("save-extension-append");
        let selected_path = dir.join("layered");
        let filter = NativeFileFilter {
            name: "PSD (レイヤー保持)".to_string(),
            extensions: vec!["psd".to_string()],
        };

        let path = enforce_save_extension(&selected_path, &filter);

        assert_eq!(path, dir.join("layered.psd"));
    }

    #[test]
    fn normalize_user_path_keeps_missing_file_inside_existing_parent() {
        let dir = temp_dir("missing-file");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join("new-image.aipaint");

        let normalized = normalize_user_path(&path).expect("missing file path should normalize");
        let expected = dir
            .canonicalize()
            .expect("temp dir should canonicalize")
            .join("new-image.aipaint");

        assert_eq!(normalized, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn normalize_user_path_rejects_missing_parent() {
        let path = temp_dir("missing-parent").join("new-image.aipaint");

        let err = normalize_user_path(&path).expect_err("missing parent should fail");

        assert!(!err.is_empty());
    }

    #[test]
    fn registered_writable_path_allows_equivalent_existing_path() {
        let dir = temp_dir("registered");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"old").expect("temp file should be written");
        let state = FileAccessState::default();

        register_writable_path(&state, &file_path).expect("path should register");
        let nested_equivalent = dir.join(".").join("image.aipaint");
        let allowed =
            ensure_writable_path(&state, &nested_equivalent).expect("registered path should pass");

        assert_eq!(
            allowed,
            file_path.canonicalize().expect("file should canonicalize")
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unregistered_writable_path_is_rejected() {
        let dir = temp_dir("unregistered");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"old").expect("temp file should be written");
        let state = FileAccessState::default();

        let err =
            ensure_writable_path(&state, &file_path).expect_err("unregistered path should fail");

        assert!(!err.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn write_session_writes_chunks_and_registers_path() {
        let dir = temp_dir("write-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        let state = FileAccessState::default();

        let write_id = begin_write_session(&state, file_path.clone())
            .await
            .expect("write session should start");
        write_file_chunk_to_session(&state, &write_id, b"ai-")
            .await
            .expect("first chunk should write");
        write_file_chunk_to_session(&state, &write_id, b"paint")
            .await
            .expect("second chunk should write");
        let written_path = finish_write_session(&state, &write_id)
            .await
            .expect("write session should finish");
        register_writable_path(&state, &written_path).expect("finished path should register");

        assert_eq!(
            fs::read(&file_path).expect("written file should be readable"),
            b"ai-paint"
        );
        ensure_writable_path(&state, &file_path).expect("finished path should be writable");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn write_session_preserves_existing_file_until_finish() {
        let dir = temp_dir("atomic-write-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"old-paint").expect("temp file should be written");
        let state = FileAccessState::default();

        let write_id = begin_write_session(&state, file_path.clone())
            .await
            .expect("write session should start");
        assert_eq!(
            fs::read(&file_path).expect("existing file should remain readable"),
            b"old-paint"
        );
        write_file_chunk_to_session(&state, &write_id, b"new-paint")
            .await
            .expect("chunk should write to temp file");
        assert_eq!(
            fs::read(&file_path).expect("existing file should remain readable"),
            b"old-paint"
        );

        finish_write_session(&state, &write_id)
            .await
            .expect("write session should finish");

        assert_eq!(
            fs::read(&file_path).expect("written file should be readable"),
            b"new-paint"
        );
        assert!(write_temp_files(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancelled_write_session_cannot_receive_more_chunks() {
        let dir = temp_dir("cancel-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        let state = FileAccessState::default();

        let write_id = begin_write_session(&state, file_path)
            .await
            .expect("write session should start");
        cancel_write_session(&state, &write_id).await;

        let err = write_file_chunk_to_session(&state, &write_id, b"late")
            .await
            .expect_err("cancelled session should be gone");

        assert!(!err.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancelled_write_session_removes_temp_file_and_preserves_target() {
        let dir = temp_dir("cancel-temp-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"old-paint").expect("temp file should be written");
        let state = FileAccessState::default();

        let write_id = begin_write_session(&state, file_path.clone())
            .await
            .expect("write session should start");
        write_file_chunk_to_session(&state, &write_id, b"partial")
            .await
            .expect("chunk should write to temp file");
        assert!(!write_temp_files(&dir).is_empty());

        cancel_write_session(&state, &write_id).await;

        assert_eq!(
            fs::read(&file_path).expect("existing file should remain readable"),
            b"old-paint"
        );
        assert!(write_temp_files(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn read_session_reads_chunks_and_registers_path() {
        let dir = temp_dir("read-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"ai-paint").expect("temp file should be written");
        let state = FileAccessState::default();

        let session = begin_read_session(&state, file_path.clone())
            .await
            .expect("read session should start");
        let first = read_file_chunk_from_session(&state, &session.read_id, 3)
            .await
            .expect("first chunk should read");
        let second = read_file_chunk_from_session(&state, &session.read_id, 5)
            .await
            .expect("second chunk should read");
        let eof = read_file_chunk_from_session(&state, &session.read_id, 5)
            .await
            .expect("eof chunk should read");
        let read_path = finish_read_session(&state, &session.read_id)
            .await
            .expect("read session should finish");
        register_writable_path(&state, &read_path).expect("finished path should register");

        assert_eq!(first.bytes, b"ai-");
        assert_eq!(second.bytes, b"paint");
        assert!(eof.bytes.is_empty());
        ensure_writable_path(&state, &file_path).expect("opened path should be writable");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn startup_open_files_return_read_sessions_and_drain_once() {
        let dir = temp_dir("startup-open-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let first_path = dir.join("first.aipaint");
        let second_path = dir.join("second.png");
        fs::write(&first_path, b"first").expect("first temp file should be written");
        fs::write(&second_path, b"second").expect("second temp file should be written");
        let state = FileAccessState::new(vec![first_path.clone(), second_path.clone()]);

        let results = take_startup_open_files(&state)
            .await
            .expect("startup open files should start read sessions");
        let drained_again = take_startup_open_files(&state)
            .await
            .expect("startup open files should be drained");

        assert_eq!(results.len(), 2);
        assert!(drained_again.is_empty());
        assert_eq!(
            results[0].path.as_deref(),
            Some(first_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            results[1].path.as_deref(),
            Some(second_path.to_string_lossy().as_ref())
        );
        assert_eq!(results[0].file_size, Some(5));
        assert_eq!(
            results[0].header_bytes.as_deref(),
            Some(b"first".as_slice())
        );
        assert_eq!(results[1].file_size, Some(6));
        assert_eq!(
            results[1].header_bytes.as_deref(),
            Some(b"second".as_slice())
        );
        let first_read_id = results[0]
            .read_id
            .as_deref()
            .expect("first result should have read id");
        let first_chunk = read_file_chunk_from_session(&state, first_read_id, 16)
            .await
            .expect("first startup session should be readable");
        assert_eq!(first_chunk.bytes, b"first");

        for result in results {
            if let Some(read_id) = result.read_id {
                cancel_read_session(&state, &read_id).await;
            }
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn startup_open_files_cancel_started_sessions_on_error() {
        let dir = temp_dir("startup-open-error");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let ok_path = dir.join("ok.aipaint");
        let unsupported_path = dir.join("unsupported.txt");
        fs::write(&ok_path, b"ok").expect("ok temp file should be written");
        fs::write(&unsupported_path, b"unsupported")
            .expect("unsupported temp file should be written");
        let state = FileAccessState::new(vec![ok_path, unsupported_path]);

        let err = match take_startup_open_files(&state).await {
            Ok(_) => panic!("unsupported startup path should fail"),
            Err(err) => err,
        };

        assert!(!err.is_empty());
        assert!(state.read_sessions.lock().await.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancelled_read_session_cannot_read_more_chunks() {
        let dir = temp_dir("cancel-read-session");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_path = dir.join("image.aipaint");
        fs::write(&file_path, b"ai-paint").expect("temp file should be written");
        let state = FileAccessState::default();

        let session = begin_read_session(&state, file_path)
            .await
            .expect("read session should start");
        cancel_read_session(&state, &session.read_id).await;

        let result = read_file_chunk_from_session(&state, &session.read_id, 4).await;

        assert!(result.is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
