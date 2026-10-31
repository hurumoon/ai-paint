import {
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AppDialogActions } from "../../components/dialogs/types";
import type { CanvasExtendPreview } from "../../types";
import type { AppActionControllers } from "../useAppActionControllers";
import type { AppDialogsController } from "../useAppDialogs";
import type { ToolState } from "../useToolState";

interface UseAppDialogActionsModelParams {
  dialogs: AppDialogsController;
  setCanvasExtendPreview: Dispatch<SetStateAction<CanvasExtendPreview | null>>;
  toolState: ToolState;
  actions: AppActionControllers;
}

export function useAppDialogActionsModel({
  dialogs,
  setCanvasExtendPreview,
  toolState,
  actions: appActions,
}: UseAppDialogActionsModelParams): AppDialogActions {
  const {
    setShowAboutDialog,
    setShowShortcutSettings,
    setShowCanvasSettings,
    setShowCanvasExtendDialog,
    setShowLayoutSettings,
    setShowExportDialog,
    setShowBackupPanel,
    setShowNewCanvasDialog,
    setShowColorAdjustDialog,
  } = dialogs;
  const { handleClearColorHistory } = toolState;
  const { handleSavedAsProject } = appActions.exportActions;
  const { handleNewCanvasConfirm } = appActions.newCanvasActions;

  return useMemo<AppDialogActions>(
    () => ({
      onCloseAboutDialog: () => setShowAboutDialog(false),
      onCloseShortcutSettings: () => setShowShortcutSettings(false),
      onCloseCanvasSettings: () => setShowCanvasSettings(false),
      onCloseCanvasExtendDialog: () => setShowCanvasExtendDialog(false),
      onCanvasExtendPreviewChange: setCanvasExtendPreview,
      onClearColorHistory: handleClearColorHistory,
      onCloseLayoutSettings: () => setShowLayoutSettings(false),
      onCloseExportDialog: () => setShowExportDialog(false),
      onSavedAsProject: handleSavedAsProject,
      onCloseBackupPanel: () => setShowBackupPanel(false),
      onCloseNewCanvasDialog: () => setShowNewCanvasDialog(false),
      onNewCanvasConfirm: handleNewCanvasConfirm,
      onCloseColorAdjustDialog: () => setShowColorAdjustDialog(false),
    }),
    [
      handleClearColorHistory,
      handleNewCanvasConfirm,
      handleSavedAsProject,
      setCanvasExtendPreview,
      setShowAboutDialog,
      setShowBackupPanel,
      setShowCanvasExtendDialog,
      setShowCanvasSettings,
      setShowColorAdjustDialog,
      setShowExportDialog,
      setShowLayoutSettings,
      setShowNewCanvasDialog,
      setShowShortcutSettings,
    ]
  );
}
