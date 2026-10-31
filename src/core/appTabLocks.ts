export interface TabLockState {
  savingFileName: string | null;
  anyDialogOpen: boolean;
  chatLoading: boolean;
}

export interface TabActionLockState extends TabLockState {
  aiLoading: boolean;
}

export function isTabsLocked({
  savingFileName,
  anyDialogOpen,
  chatLoading,
}: TabLockState): boolean {
  return savingFileName !== null || anyDialogOpen || chatLoading;
}

export function areTabActionsLocked(state: TabActionLockState): boolean {
  return isTabsLocked(state) || state.aiLoading;
}

export function tabSwitchBlockedReason({
  saving,
  painting,
  anyDialogOpen,
  chatLoading,
}: {
  saving: boolean;
  painting: boolean;
  anyDialogOpen: boolean;
  chatLoading: boolean;
}): string | null {
  if (saving) return "保存中はタブ切替できません";
  if (painting) return "描画中はタブ切替できません";
  if (anyDialogOpen) return "ダイアログを閉じてからタブを切替えてください";
  if (chatLoading) return "チャット送信完了までお待ちください";
  return null;
}
