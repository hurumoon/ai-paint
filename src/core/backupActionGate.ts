export type BackupChangeAction =
  | "restore-current"
  | "restore-new-tab"
  | "delete";

export interface BackupActionGateState {
  hasActiveTab: boolean;
  saving: boolean;
  fileLoading: boolean;
  painting: boolean;
  aiLoading: boolean;
  chatLoading: boolean;
  operationBusy: boolean;
}

export type AutoBackupStartGateState = Pick<
  BackupActionGateState,
  "saving" | "fileLoading" | "painting" | "aiLoading" | "chatLoading"
>;

export type BackupActionGateDecision =
  | { allowed: true }
  | { allowed: false; message: string };

function blocked(message: string): BackupActionGateDecision {
  return { allowed: false, message };
}

export function canStartAutoBackup(state: AutoBackupStartGateState): boolean {
  return (
    !state.saving &&
    !state.fileLoading &&
    !state.painting &&
    !state.aiLoading &&
    !state.chatLoading
  );
}

export function checkBackupActionGate(
  action: BackupChangeAction,
  state: BackupActionGateState
): BackupActionGateDecision {
  if (action === "delete") {
    return state.operationBusy
      ? blocked("バックアップ処理中は削除・整理できません")
      : { allowed: true };
  }

  const label =
    action === "restore-current" ? "現在のタブへ復元" : "新しいタブで復元";
  if (action === "restore-current" && !state.hasActiveTab) {
    return blocked("復元先のタブがありません");
  }
  if (state.saving) return blocked(`保存中は${label}できません`);
  if (state.fileLoading) {
    return blocked(`ファイル読み込み中は${label}できません`);
  }
  if (state.painting) return blocked(`描画中は${label}できません`);
  if (state.aiLoading) return blocked(`AI処理中は${label}できません`);

  if (action === "restore-current") {
    return state.operationBusy
      ? blocked("対象タブのバックアップ処理中は復元できません")
      : { allowed: true };
  }

  if (state.chatLoading) {
    return blocked("チャット送信中は新しいタブで復元できません");
  }
  return state.operationBusy
    ? blocked("バックアップ処理中は新しいタブで復元できません")
    : { allowed: true };
}
