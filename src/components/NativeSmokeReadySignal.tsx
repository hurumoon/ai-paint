import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function NativeSmokeReadySignal() {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    void invoke("native_signal_frontend_ready").catch((err) => {
      console.warn("native smoke ready signal failed:", err);
    });
  }, []);

  return null;
}
