import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { setStartupSplashProgress } from "./components/StartupSplash";
import "./styles.css";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

if (import.meta.env.DEV) {
  void import("./debug/ipcProbe").then(({ installDebugIpcProbe }) => installDebugIpcProbe());
}

async function bootstrap(): Promise<void> {
  setStartupSplashProgress("一時ファイルを確認中...", 18);

  if (isTauriRuntime()) {
    try {
      await invoke("native_cleanup_atomic_write_temps");
    } catch (err) {
      console.warn("atomic write temp cleanup failed:", err);
    }
  }

  setStartupSplashProgress("React を初期化中...", 28);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
