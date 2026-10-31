import {
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AppDialogsDocumentState,
  AppDialogsModel,
} from "../components/dialogs/types";
import type { CanvasExtendPreview } from "../types";
import type { AppActionControllers } from "./useAppActionControllers";
import type { ActiveTabDocumentState } from "./useActiveTabDocument";
import type { AppDialogsController } from "./useAppDialogs";
import type { AppCanvasViewState } from "./useCanvasViewState";
import type { ToolState } from "./useToolState";
import { useAppDialogActionsModel } from "./dialogs/useAppDialogActionsModel";
import { useAppDialogSettingsModel } from "./dialogs/useAppDialogSettingsModel";
import type { UseAppDialogSettingsModelParams } from "./dialogs/useAppDialogSettingsModel";
import { useAppDialogVisibilityModel } from "./dialogs/useAppDialogVisibilityModel";

type UseAppDialogModelSettings = UseAppDialogSettingsModelParams["settings"] & {
  setCanvasExtendPreview: Dispatch<SetStateAction<CanvasExtendPreview | null>>;
};

interface UseAppDialogModelParams {
  activeDocument: ActiveTabDocumentState;
  viewState: AppCanvasViewState;
  dialogs: AppDialogsController;
  settings: UseAppDialogModelSettings;
  toolState: ToolState;
  actions: AppActionControllers;
}

export function useAppDialogModel({
  activeDocument,
  viewState,
  dialogs,
  settings: dialogSettings,
  toolState,
  actions: appActions,
}: UseAppDialogModelParams): AppDialogsModel {
  const { doc, history, isDirty } = activeDocument;
  const { selection } = viewState;

  const documentState = useMemo<AppDialogsDocumentState>(
    () => ({ doc, history, selection, isDirty }),
    [doc, history, isDirty, selection]
  );
  const visibility = useAppDialogVisibilityModel(dialogs);
  const settings = useAppDialogSettingsModel({
    settings: dialogSettings,
    viewState,
    toolState,
    actions: appActions,
  });
  const actions = useAppDialogActionsModel({
    dialogs,
    setCanvasExtendPreview: dialogSettings.setCanvasExtendPreview,
    toolState,
    actions: appActions,
  });

  return useMemo<AppDialogsModel>(
    () => ({
      documentState,
      visibility,
      settings,
      actions,
    }),
    [actions, documentState, settings, visibility]
  );
}
