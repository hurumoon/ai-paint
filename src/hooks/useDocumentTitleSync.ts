import { useEffect } from "react";
import { isTauri } from "../utils/saveFile";

interface UseDocumentTitleSyncOptions {
  currentFileName: string | null;
  hasActiveTab: boolean;
  isDirty: boolean;
}

export function useDocumentTitleSync({
  currentFileName,
  hasActiveTab,
  isDirty,
}: UseDocumentTitleSyncOptions): void {
  useEffect(() => {
    const baseTitle = currentFileName ?? (hasActiveTab ? "Untitled" : "No Canvas");
    const title = `${isDirty ? "*" : ""}${baseTitle} - AI Paint`;
    document.title = title;
    if (isTauri()) {
      let cancelled = false;
      (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          if (cancelled) return;
          await getCurrentWindow().setTitle(title);
        } catch {
          // ウィンドウ取得失敗時は document.title のみで継続
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [currentFileName, hasActiveTab, isDirty]);
}
