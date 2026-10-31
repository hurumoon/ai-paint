use std::{ffi::OsString, fs, path::PathBuf};

const SMOKE_READY_FILE_ENV: &str = "AI_PAINT_SMOKE_READY_FILE";

fn write_ready_file(path: Option<OsString>) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    let path = PathBuf::from(path);
    if path.as_os_str().is_empty() {
        return Ok(());
    }

    fs::write(&path, b"ready\n").map_err(|err| {
        format!(
            "スモークテストのreadyファイルを書き込めませんでした ({}): {}",
            path.display(),
            err
        )
    })
}

#[tauri::command]
pub fn native_signal_frontend_ready() -> Result<(), String> {
    write_ready_file(std::env::var_os(SMOKE_READY_FILE_ENV))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ai-paint-smoke-ready-{name}-{unique}.txt"))
    }

    #[test]
    fn does_nothing_without_a_ready_file_path() {
        write_ready_file(None).expect("missing smoke env should be a no-op");
    }

    #[test]
    fn writes_ready_marker_to_the_requested_path() {
        let path = temp_file("write");

        write_ready_file(Some(path.as_os_str().to_owned()))
            .expect("ready marker should be written");

        assert_eq!(
            fs::read_to_string(&path).expect("ready marker should be readable"),
            "ready\n"
        );
        fs::remove_file(path).expect("ready marker should be removable");
    }

    #[test]
    fn reports_an_unwritable_ready_file_path() {
        let directory = std::env::temp_dir();
        let error = write_ready_file(Some(directory.as_os_str().to_owned()))
            .expect_err("writing a directory as a file should fail");

        assert!(error.contains("readyファイルを書き込めませんでした"));
        assert!(directory.is_dir());
    }
}
