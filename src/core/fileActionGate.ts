export type FileActionKind = "open-file" | "open-image" | "save";

export type FileActionBlockReason =
  | "loading"
  | "saving"
  | "painting"
  | "auto-backup"
  | "dialog"
  | "no-active-tab";

export interface FileActionGateState {
  loading: boolean;
  saving: boolean;
  painting: boolean;
  autoBackupBusy: boolean;
  anyDialogOpen: boolean;
  hasActiveTab: boolean;
}

export type FileActionGateDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: FileActionBlockReason;
      message?: string;
    };

function blocked(
  reason: FileActionBlockReason,
  message?: string,
): FileActionGateDecision {
  return { allowed: false, reason, message };
}

export function checkFileActionGate(
  action: FileActionKind,
  state: FileActionGateState,
): FileActionGateDecision {
  if (action === "save") {
    if (state.saving) return blocked("saving");
    if (state.loading) {
      return blocked(
        "loading",
        "ファイル読み込み中は保存できません。完了してから再度実行してください",
      );
    }
    if (!state.hasActiveTab) {
      return blocked("no-active-tab", "保存対象のキャンバスがありません");
    }
    if (state.autoBackupBusy) {
      return blocked(
        "auto-backup",
        "バックアップ中は保存できません。完了してから再度実行してください",
      );
    }
    if (state.painting) {
      return blocked(
        "painting",
        "描画中は保存できません。完了してから再度実行してください",
      );
    }
    return { allowed: true };
  }

  const label = action === "open-file" ? "ファイル" : "画像";
  if (state.loading) {
    return blocked("loading", `ファイル読み込み中は別の${label}を開けません`);
  }
  if (state.saving) {
    return blocked("saving", `保存中は${label}を開けません`);
  }
  if (state.autoBackupBusy) {
    return blocked("auto-backup", `バックアップ中は${label}を開けません`);
  }
  if (state.painting) {
    return blocked("painting", `描画中は${label}を開けません`);
  }
  if (state.anyDialogOpen) {
    return blocked("dialog", `ダイアログを閉じてから${label}を開いてください`);
  }
  return { allowed: true };
}
