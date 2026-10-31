pub(crate) fn ensure_main_window(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("この操作はメインウィンドウからのみ実行できます".to_string())
    }
}
