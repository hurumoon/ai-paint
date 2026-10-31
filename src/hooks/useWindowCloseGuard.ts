import { useEffect } from "react";
import { isTauri } from "../utils/saveFile";
import { tabHasUnsavedChanges, type TabStore } from "./useTabs";

interface UseWindowCloseGuardOptions {
  tabStore: TabStore;
}

interface WindowCloseRequestOptions {
  tabStore: TabStore;
  preventDefault: () => void;
  ask: (message: string) => Promise<boolean>;
  confirm: (message: string) => boolean;
  destroy: () => Promise<void>;
}

export async function handleWindowCloseRequest({
  tabStore,
  preventDefault,
  ask,
  confirm,
  destroy,
}: WindowCloseRequestOptions): Promise<boolean> {
  const dirtyTabs = tabStore.tabs.filter(tabHasUnsavedChanges);
  if (dirtyTabs.length === 0) return false;
  preventDefault();
  const labels = dirtyTabs
    .map((tab) => tab.fileName ?? `名称未設定${tab.untitledIndex}`)
    .join("、");
  const message =
    dirtyTabs.length === 1
      ? `「${labels}」には未保存の変更があります。アプリケーションを終了してもよろしいですか？`
      : `${dirtyTabs.length} 個のタブ（${labels}）に未保存の変更があります。アプリケーションを終了してもよろしいですか？`;
  let confirmed = false;
  try {
    confirmed = await ask(message);
  } catch {
    confirmed = confirm(message);
  }
  if (confirmed) await destroy();
  return true;
}

export function useWindowCloseGuard({
  tabStore,
}: UseWindowCloseGuardOptions): void {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (cancelled) return;
        const handler = await win.onCloseRequested(async (event) => {
          await handleWindowCloseRequest({
            tabStore,
            preventDefault: () => event.preventDefault(),
            ask: async (message) => {
              const { ask } = await import("@tauri-apps/plugin-dialog");
              return ask(message, {
                title: "未保存の変更",
                kind: "warning",
                okLabel: "終了",
                cancelLabel: "キャンセル",
              });
            },
            confirm: (message) => window.confirm(message),
            // close() は再度 onCloseRequested を発火させるため destroy() で抜ける。
            destroy: () => win.destroy(),
          });
        });
        if (cancelled) {
          handler();
        } else {
          unlisten = handler;
        }
      } catch (err) {
        console.warn("Failed to register window close handler:", err);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [tabStore]);
}
