import type { ToolOptionsProps } from "../../components/ToolOptions";
import type { LayoutConfig } from "../../core/panelLayout";
import type { Theme } from "../../types";
import type { AppActionControllers } from "../useAppActionControllers";
import type { ActiveTabDocumentState } from "../useActiveTabDocument";
import type { AppDialogsController } from "../useAppDialogs";
import type { AppCanvasViewState } from "../useCanvasViewState";
import type { CanvasViewCommands } from "../useCanvasViewCommands";
import type { ToolState } from "../useToolState";
import type { Tab } from "../useTabs";

export interface UseAppChromeModelParams {
  app: {
    theme: Theme;
    toggleTheme: () => void;
    hasActiveTab: boolean;
  };
  tabs: {
    tabs: Tab[];
    activeTabId: string | null;
  };
  activeDocument: ActiveTabDocumentState;
  tool: {
    toolState: ToolState;
    toolOptionsProps: ToolOptionsProps;
  };
  view: {
    viewState: AppCanvasViewState;
    viewCommands: CanvasViewCommands;
  };
  layout: Pick<LayoutConfig, "topBarLeftItems" | "topBarRightItems">;
  dialogs: AppDialogsController;
  actions: AppActionControllers;
}
