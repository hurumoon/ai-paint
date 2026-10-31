import { useCallback, type MutableRefObject } from "react";
import { areTabActionsLocked, tabSwitchBlockedReason } from "../core/appTabLocks";
import { pushToast } from "../ui/primitives";
import { isTauri } from "../utils/saveFile";
import { tabHasUnsavedChanges, type Tab, type TabStore } from "./useTabs";

interface UseTabActionsOptions {
  tabStore: TabStore;
  savingRef: MutableRefObject<boolean>;
  paintBusyRef: MutableRefObject<boolean>;
  anyDialogOpen: boolean;
  chatLoading: boolean;
  aiLoading: boolean;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
  isAutoBackupBusy: () => boolean;
}

export function useTabActions({
  tabStore,
  savingRef,
  paintBusyRef,
  anyDialogOpen,
  chatLoading,
  aiLoading,
  stashAndAddTab,
  isAutoBackupBusy,
}: UseTabActionsOptions) {
  const tabIsDirty = useCallback((t: Tab) => tabHasUnsavedChanges(t), []);
  const autoBackupBusy = isAutoBackupBusy();

  // paintBusyRef は pointer capture 中に TabBar へクリックが届かないため、見た目の
  // disabled には含めない。AI 処理は開始時の target tab に結果を戻せるため、タブ選択だけは許可する。
  const tabsLocked =
    savingRef.current || anyDialogOpen || chatLoading || autoBackupBusy;
  const tabActionsLocked =
    autoBackupBusy ||
    areTabActionsLocked({
      savingFileName: savingRef.current ? "saving" : null,
      anyDialogOpen,
      chatLoading,
      aiLoading,
    });

  const handleSelectTab = useCallback(
    (id: string) => {
      if (isAutoBackupBusy()) {
        pushToast("バックアップ中はタブを切り替えられません");
        return;
      }
      const blockedReason = tabSwitchBlockedReason({
        saving: savingRef.current,
        painting: paintBusyRef.current,
        anyDialogOpen,
        chatLoading,
      });
      if (blockedReason) {
        pushToast(blockedReason);
        return;
      }
      tabStore.setActiveTab(id);
    },
    [tabStore, savingRef, paintBusyRef, anyDialogOpen, chatLoading, isAutoBackupBusy]
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      if (isAutoBackupBusy()) {
        pushToast("バックアップ中はタブを閉じられません");
        return;
      }
      if (savingRef.current) {
        pushToast("保存中はタブを閉じられません");
        return;
      }
      const target = tabStore.tabs.find((t) => t.id === id);
      if (!target) return;
      if (chatLoading || aiLoading) {
        pushToast(chatLoading ? "チャット送信完了までお待ちください" : "AI処理完了までお待ちください");
        return;
      }
      if (anyDialogOpen && tabStore.activeTabId === id) {
        pushToast("ダイアログを閉じてからタブを閉じてください");
        return;
      }
      if (tabIsDirty(target)) {
        const label = target.fileName ?? `名称未設定${target.untitledIndex}`;
        const message = `「${label}」には未保存の変更があります。閉じてもよろしいですか？`;
        // Tauri webview では window.confirm が無視されるケースがあるため、plugin-dialog を優先する。
        let ok: boolean;
        if (isTauri()) {
          try {
            const { ask } = await import("@tauri-apps/plugin-dialog");
            ok = await ask(message, {
              title: "未保存の変更",
              kind: "warning",
              okLabel: "閉じる",
              cancelLabel: "キャンセル",
            });
          } catch {
            ok = window.confirm(message);
          }
        } else {
          ok = window.confirm(message);
        }
        if (!ok) return;
      }
      tabStore.closeTab(id);
    },
    [
      tabStore,
      savingRef,
      anyDialogOpen,
      tabIsDirty,
      chatLoading,
      aiLoading,
      isAutoBackupBusy,
    ]
  );

  const handleAddBlankTab = useCallback(() => {
    if (isAutoBackupBusy()) {
      pushToast("バックアップ中は新しいタブを追加できません");
      return;
    }
    if (savingRef.current) return;
    if (chatLoading || aiLoading) {
      pushToast(chatLoading ? "チャット送信完了までお待ちください" : "AI処理完了までお待ちください");
      return;
    }
    if (anyDialogOpen) {
      pushToast("ダイアログを閉じてから新規タブを追加してください");
      return;
    }
    stashAndAddTab();
  }, [
    stashAndAddTab,
    savingRef,
    anyDialogOpen,
    chatLoading,
    aiLoading,
    isAutoBackupBusy,
  ]);

  const handleReorderTab = useCallback(
    (from: number, to: number) => {
      if (tabActionsLocked) return;
      tabStore.reorderTab(from, to);
    },
    [tabStore, tabActionsLocked]
  );

  return {
    tabIsDirty,
    tabsLocked,
    tabActionsLocked,
    handleSelectTab,
    handleCloseTab,
    handleAddBlankTab,
    handleReorderTab,
  };
}

export type TabActions = ReturnType<typeof useTabActions>;
