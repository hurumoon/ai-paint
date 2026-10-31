import { useMemo } from "react";
import type { AppDialogVisibility } from "../../components/dialogs/types";
import type { AppDialogsController } from "../useAppDialogs";

export function useAppDialogVisibilityModel(
  dialogs: AppDialogsController
): AppDialogVisibility {
  const {
    showAboutDialog,
    showShortcutSettings,
    showCanvasSettings,
    showCanvasExtendDialog,
    showLayoutSettings,
    showExportDialog,
    showBackupPanel,
    showNewCanvasDialog,
    showColorAdjustDialog,
  } = dialogs;

  return useMemo<AppDialogVisibility>(
    () => ({
      showAboutDialog,
      showShortcutSettings,
      showCanvasSettings,
      showCanvasExtendDialog,
      showLayoutSettings,
      showExportDialog,
      showBackupPanel,
      showNewCanvasDialog,
      showColorAdjustDialog,
    }),
    [
      showAboutDialog,
      showBackupPanel,
      showCanvasExtendDialog,
      showCanvasSettings,
      showColorAdjustDialog,
      showExportDialog,
      showLayoutSettings,
      showNewCanvasDialog,
      showShortcutSettings,
    ]
  );
}
