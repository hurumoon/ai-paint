import { useCallback, type MutableRefObject } from "react";
import { pushToast } from "../ui/primitives";
import type { Tab } from "./useTabs";

interface UseNewCanvasActionsOptions {
  savingRef: MutableRefObject<boolean>;
  paintBusyRef: MutableRefObject<boolean>;
  chatLoading: boolean;
  aiLoading: boolean;
  isAutoBackupBusy: () => boolean;
  openNewCanvasDialog: () => void;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
}

export function useNewCanvasActions({
  savingRef,
  paintBusyRef,
  chatLoading,
  aiLoading,
  isAutoBackupBusy,
  openNewCanvasDialog,
  stashAndAddTab,
}: UseNewCanvasActionsOptions) {
  // Confirm は NewCanvasDialog 表示中に呼ばれるため、他ダイアログの open 判定は不要。
  const handleNewCanvasConfirm = useCallback(
    (w: number, h: number, dpiV: number) => {
      if (chatLoading || aiLoading) {
        pushToast(chatLoading ? "チャット送信完了までお待ちください" : "AI処理完了までお待ちください");
        return;
      }
      if (savingRef.current) {
        pushToast("保存中は新規作成できません");
        return;
      }
      if (isAutoBackupBusy()) {
        pushToast("バックアップ中は新規作成できません");
        return;
      }
      stashAndAddTab(w, h, dpiV);
      pushToast(`新規キャンバスを作成しました (${w}×${h})`, "success");
    },
    [chatLoading, aiLoading, isAutoBackupBusy, savingRef, stashAndAddTab]
  );

  const handleOpenNewCanvasDialog = useCallback(() => {
    if (chatLoading || aiLoading) {
      pushToast(chatLoading ? "チャット送信完了までお待ちください" : "AI処理完了までお待ちください");
      return;
    }
    if (savingRef.current) {
      pushToast("保存中は新規作成できません");
      return;
    }
    if (paintBusyRef.current) {
      pushToast("描画中は新規作成できません");
      return;
    }
    if (isAutoBackupBusy()) {
      pushToast("バックアップ中は新規作成できません");
      return;
    }
    openNewCanvasDialog();
  }, [chatLoading, aiLoading, isAutoBackupBusy, savingRef, paintBusyRef, openNewCanvasDialog]);

  return {
    handleNewCanvasConfirm,
    handleOpenNewCanvasDialog,
  };
}

export type NewCanvasActions = ReturnType<typeof useNewCanvasActions>;
