use std::{
    io::{self, SeekFrom},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::FileAccessState;

const MAX_NATIVE_FILE_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const NATIVE_OPEN_HEADER_BYTES: usize = 26;

pub(in crate::native_files) struct NativeReadSession {
    file: tokio::fs::File,
    path: PathBuf,
}

pub(in crate::native_files) struct NativeWriteSession {
    file: tokio::fs::File,
    path: PathBuf,
    temp_path: PathBuf,
}

pub(super) struct NativeReadSessionStart {
    pub(super) read_id: String,
    pub(super) file_size: u64,
    pub(super) header_bytes: Vec<u8>,
}

pub(super) struct NativeReadChunk {
    pub(super) bytes: Vec<u8>,
}

fn next_read_id(state: &FileAccessState) -> String {
    let id = state
        .next_read_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("native-read-{id}")
}

fn next_write_id(state: &FileAccessState) -> String {
    let id = state
        .next_write_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("native-write-{id}")
}

fn temp_path_for_write(path: &Path, write_id: &str, attempt: u32) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| "保存先ファイル名を確認できません".to_string())?
        .to_string_lossy();
    let parent = path
        .parent()
        .ok_or_else(|| "保存先フォルダーを確認できません".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Ok(parent.join(format!(
        "{file_name}.tmp-{}-{write_id}-{timestamp}-{attempt}",
        std::process::id()
    )))
}

async fn create_temp_write_file(
    path: &Path,
    write_id: &str,
) -> Result<(tokio::fs::File, PathBuf), String> {
    for attempt in 0..100 {
        let temp_path = temp_path_for_write(path, write_id, attempt)?;
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .await
        {
            Ok(file) => return Ok((file, temp_path)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!("一時ファイルを作成できません: {}", err));
            }
        }
    }
    Err("一時ファイル名を確保できません".to_string())
}

#[cfg(windows)]
fn persist_temp_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    if path.exists() {
        replace_existing_file(path, temp_path)
    } else {
        std::fs::rename(temp_path, path)
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
fn persist_temp_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    std::fs::rename(temp_path, path)
}

#[cfg(unix)]
fn best_effort_sync_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::File::open(parent).and_then(|file| file.sync_all());
    }
}

#[cfg(not(unix))]
fn best_effort_sync_parent(_path: &Path) {}

async fn remove_temp_file(temp_path: &Path) {
    let _ = tokio::fs::remove_file(temp_path).await;
}

async fn finish_temp_write_file(
    mut file: tokio::fs::File,
    path: PathBuf,
    temp_path: PathBuf,
) -> Result<PathBuf, String> {
    if let Err(err) = file.flush().await {
        drop(file);
        remove_temp_file(&temp_path).await;
        return Err(format!("ファイル保存を完了できません: {}", err));
    }
    if let Err(err) = file.sync_all().await {
        drop(file);
        remove_temp_file(&temp_path).await;
        return Err(format!("ファイル保存を完了できません: {}", err));
    }
    drop(file);

    let replace_path = path.clone();
    let replace_temp_path = temp_path.clone();
    let replace_result = tokio::task::spawn_blocking(move || {
        persist_temp_file(&replace_temp_path, &replace_path)?;
        best_effort_sync_parent(&replace_path);
        Ok::<(), io::Error>(())
    })
    .await
    .map_err(|e| format!("ファイル保存処理を完了できません: {}", e))?;

    if let Err(err) = replace_result {
        remove_temp_file(&temp_path).await;
        return Err(format!("ファイル保存を完了できません: {}", err));
    }

    Ok(path)
}

pub(super) async fn begin_read_session(
    state: &FileAccessState,
    path: PathBuf,
) -> Result<NativeReadSessionStart, String> {
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("ファイルを読み込めません: {}", e))?;
    let file_size = file
        .metadata()
        .await
        .map_err(|e| format!("ファイルサイズを確認できません: {}", e))?
        .len();
    let mut header_bytes = vec![0; NATIVE_OPEN_HEADER_BYTES];
    let mut header_len = 0;
    while header_len < header_bytes.len() {
        let read = file
            .read(&mut header_bytes[header_len..])
            .await
            .map_err(|e| format!("ファイルヘッダーを読み込めません: {}", e))?;
        if read == 0 {
            break;
        }
        header_len += read;
    }
    header_bytes.truncate(header_len);
    file.seek(SeekFrom::Start(0))
        .await
        .map_err(|e| format!("ファイルの読み込み位置を戻せません: {}", e))?;
    let read_id = next_read_id(state);
    let session = NativeReadSession { file, path };
    let mut sessions = state.read_sessions.lock().await;
    sessions.insert(read_id.clone(), session);
    Ok(NativeReadSessionStart {
        read_id,
        file_size,
        header_bytes,
    })
}

pub(super) async fn read_file_chunk_from_session(
    state: &FileAccessState,
    read_id: &str,
    max_bytes: usize,
) -> Result<NativeReadChunk, String> {
    if max_bytes == 0 {
        return Err("読み込みサイズを確認できません".to_string());
    }
    let max_bytes = max_bytes.min(MAX_NATIVE_FILE_CHUNK_BYTES);
    let mut sessions = state.read_sessions.lock().await;
    let session = sessions
        .get_mut(read_id)
        .ok_or_else(|| "読み込みセッションが見つかりません".to_string())?;
    let mut bytes = vec![0; max_bytes];
    let read = session
        .file
        .read(&mut bytes)
        .await
        .map_err(|e| format!("ファイルを読み込めません: {}", e))?;
    bytes.truncate(read);
    Ok(NativeReadChunk { bytes })
}

pub(super) async fn finish_read_session(
    state: &FileAccessState,
    read_id: &str,
) -> Result<PathBuf, String> {
    let mut sessions = state.read_sessions.lock().await;
    let session = sessions
        .remove(read_id)
        .ok_or_else(|| "読み込みセッションが見つかりません".to_string())?;
    Ok(session.path)
}

pub(super) async fn cancel_read_session(state: &FileAccessState, read_id: &str) {
    let mut sessions = state.read_sessions.lock().await;
    sessions.remove(read_id);
}

pub(super) async fn begin_write_session(
    state: &FileAccessState,
    path: PathBuf,
) -> Result<String, String> {
    let write_id = next_write_id(state);
    let (file, temp_path) = create_temp_write_file(&path, &write_id).await?;
    let session = NativeWriteSession {
        file,
        path,
        temp_path,
    };
    let mut sessions = state.write_sessions.lock().await;
    sessions.insert(write_id.clone(), session);
    Ok(write_id)
}

pub(super) async fn write_file_chunk_to_session(
    state: &FileAccessState,
    write_id: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if bytes.len() > MAX_NATIVE_FILE_CHUNK_BYTES {
        return Err("書き込みサイズが大きすぎます".to_string());
    }
    let mut sessions = state.write_sessions.lock().await;
    let session = sessions
        .get_mut(write_id)
        .ok_or_else(|| "保存セッションが見つかりません".to_string())?;
    session
        .file
        .write_all(bytes)
        .await
        .map_err(|e| format!("ファイルへ書き込めません: {}", e))
}

pub(super) async fn finish_write_session(
    state: &FileAccessState,
    write_id: &str,
) -> Result<PathBuf, String> {
    let mut sessions = state.write_sessions.lock().await;
    let session = sessions
        .remove(write_id)
        .ok_or_else(|| "保存セッションが見つかりません".to_string())?;
    drop(sessions);
    finish_temp_write_file(session.file, session.path, session.temp_path).await
}

pub(super) async fn cancel_write_session(state: &FileAccessState, write_id: &str) {
    let mut sessions = state.write_sessions.lock().await;
    let session = sessions.remove(write_id);
    drop(sessions);
    if let Some(session) = session {
        drop(session.file);
        remove_temp_file(&session.temp_path).await;
    }
}
