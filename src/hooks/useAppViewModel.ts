import { useMemo } from "react";
import type { AppCanvasAreaProps } from "../components/AppCanvasArea";
import type { AppChromeModel } from "../components/AppChrome";
import type { AppDialogsModel } from "../components/dialogs/types";
import type { AppStatusBarProps } from "../components/AppStatusBar";
import type { AppPanelModel } from "../components/panels/types";

interface UseAppViewModelOptions {
  chromeModel: AppChromeModel;
  canvasAreaProps: AppCanvasAreaProps;
  panelModel: AppPanelModel;
  statusBarProps: AppStatusBarProps;
  dialogModel: AppDialogsModel;
}

interface AppViewModel {
  chromeModel: AppChromeModel;
  canvasAreaProps: AppCanvasAreaProps;
  panelModel: AppPanelModel;
  statusBarProps: AppStatusBarProps;
  dialogModel: AppDialogsModel;
}

export function useAppViewModel({
  chromeModel,
  canvasAreaProps,
  panelModel,
  statusBarProps,
  dialogModel,
}: UseAppViewModelOptions): AppViewModel {
  return useMemo<AppViewModel>(
    () => ({
      chromeModel,
      canvasAreaProps,
      panelModel,
      statusBarProps,
      dialogModel,
    }),
    [canvasAreaProps, chromeModel, dialogModel, panelModel, statusBarProps]
  );
}
