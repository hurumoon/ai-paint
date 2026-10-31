import { useCallback, useRef } from "react";
import { createSavedProjectMetadataPatch } from "../core/saveVersionGuard";
import { pushToast } from "../ui/primitives";
import type { Tab, TabStore } from "./useTabs";

interface UseExportTargetTabOptions {
  activeTab: Tab | null;
  tabStore: TabStore;
  openExportDialog: () => void;
}

export function useExportTargetTab({
  activeTab,
  tabStore,
  openExportDialog,
}: UseExportTargetTabOptions) {
  const exportTargetTabIdRef = useRef<string | null>(null);

  const handleExport = useCallback(() => {
    if (!activeTab) {
      pushToast("エクスポート対象のキャンバスがありません");
      return;
    }
    exportTargetTabIdRef.current = tabStore.activeTabId;
    openExportDialog();
  }, [activeTab, openExportDialog, tabStore]);

  const handleSavedAsProject = useCallback(
    (
      fileName: string,
      path: string | undefined,
      historyVersionAtSave: number,
      documentVersionAtSave: number,
    ) => {
      // 「開いた瞬間の active タブ」に対して書き戻す。anyDialogOpen ガードで
      // 切替は禁止されているが、念のため id を固定して直接 tabStore を叩く。
      const targetId = exportTargetTabIdRef.current ?? tabStore.activeTabId;
      if (!targetId) return;
      const targetTab = tabStore.tabs.find((tab) => tab.id === targetId);
      if (!targetTab) return;
      const { patch, hasUnsavedChangesAfterSave } = createSavedProjectMetadataPatch({
        fileName,
        path,
        historyVersionAtSave,
        documentVersionAtSave,
        currentHistoryVersion: targetTab.history.getSnapshot(),
        currentDocumentVersion: targetTab.doc.getSnapshot(),
      });
      tabStore.updateTab(targetId, patch);
      if (hasUnsavedChangesAfterSave) {
        pushToast("保存中に変更が入ったため、未保存の変更が残っています");
      }
    },
    [tabStore]
  );

  return {
    handleExport,
    handleSavedAsProject,
  };
}

export type ExportTargetTabActions = ReturnType<typeof useExportTargetTab>;
