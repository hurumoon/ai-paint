import { useCallback } from "react";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { Timelapse } from "../../core/Timelapse";
import { applyBlur } from "../../core/toolHandlers";
import { pushToast } from "../../ui/primitives";
import type { Selection } from "../../types";

interface UseBlurSessionParams {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
  blurRadius: number;
  isAutoBackupBusy?: () => boolean;
}

export function useBlurSession({
  doc,
  history,
  timelapse,
  selection,
  blurRadius,
  isAutoBackupBusy,
}: UseBlurSessionParams) {
  const applyBlurAtSelection = useCallback(async (): Promise<boolean> => {
    if (isAutoBackupBusy?.()) {
      pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
      return true;
    }
    try {
      await applyBlur(doc, history, timelapse, blurRadius, selection);
      pushToast(`ぼかし r=${blurRadius} 適用`, "success");
    } catch (err) {
      pushToast(`ぼかし失敗: ${err}`, "error");
    }
    return true;
  }, [blurRadius, doc, history, isAutoBackupBusy, selection, timelapse]);

  return { applyBlurAtSelection };
}
