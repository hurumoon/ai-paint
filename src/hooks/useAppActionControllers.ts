import { useRef, type Dispatch, type SetStateAction } from "react";
import type { AutoBackupRunner } from "../core/autoBackup";
import type { TextLayerData } from "../types";
import type { ActiveTabDocumentState } from "./useActiveTabDocument";
import { useAutoBackupController } from "./useAutoBackupController";
import { useExportTargetTab } from "./useExportTargetTab";
import { useFileActions } from "./useFileActions";
import { useNewCanvasActions } from "./useNewCanvasActions";
import { useTabActions } from "./useTabActions";
import type { Tab, TabStore } from "./useTabs";
import { useTextLayerActions } from "./useTextLayerActions";

interface UseAppActionControllersOptions {
  activeTab: Tab | null;
  tabStore: TabStore;
  activeDocument: Pick<
    ActiveTabDocumentState,
    "doc" | "history" | "currentFileName" | "currentFilePath"
  >;
  anyDialogOpen: boolean;
  chatLoading: boolean;
  aiLoading: boolean;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
  openExportDialog: () => void;
  openNewCanvasDialog: () => void;
  setDefaultTextStyle: Dispatch<SetStateAction<TextLayerData>>;
}

export function useAppActionControllers({
  activeTab,
  tabStore,
  activeDocument,
  anyDialogOpen,
  chatLoading,
  aiLoading,
  stashAndAddTab,
  openExportDialog,
  openNewCanvasDialog,
  setDefaultTextStyle,
}: UseAppActionControllersOptions) {
  const { doc, history, currentFileName, currentFilePath } = activeDocument;
  const autoBackupRunnerRef = useRef<AutoBackupRunner | null>(null);
  const fileActions = useFileActions({
    activeTab,
    tabStore,
    anyDialogOpen,
    currentFileName,
    currentFilePath,
    stashAndAddTab,
    isAutoBackupBusy: () =>
      autoBackupRunnerRef.current?.isOperationBusy() ?? false,
  });
  const autoBackup = useAutoBackupController({
    tabStore,
    activeTab,
    savingRef: fileActions.savingRef,
    paintBusyRef: fileActions.paintBusyRef,
    aiLoading,
    chatLoading,
    anyDialogOpen,
    isFileLoading: fileActions.isFileLoading,
    stashAndAddTab,
    runnerRef: autoBackupRunnerRef,
  });
  const exportActions = useExportTargetTab({
    activeTab,
    tabStore,
    openExportDialog,
  });
  const newCanvasActions = useNewCanvasActions({
    chatLoading,
    aiLoading,
    savingRef: fileActions.savingRef,
    paintBusyRef: fileActions.paintBusyRef,
    isAutoBackupBusy: autoBackup.isOperationBusy,
    openNewCanvasDialog,
    stashAndAddTab,
  });
  const textLayerActions = useTextLayerActions({
    doc,
    history,
    setDefaultTextStyle,
  });
  const tabActions = useTabActions({
    tabStore,
    savingRef: fileActions.savingRef,
    paintBusyRef: fileActions.paintBusyRef,
    anyDialogOpen,
    chatLoading,
    aiLoading,
    stashAndAddTab,
    isAutoBackupBusy: autoBackup.isOperationBusy,
  });

  return {
    fileActions,
    autoBackup,
    exportActions,
    newCanvasActions,
    textLayerActions,
    tabActions,
  };
}

export type AppActionControllers = ReturnType<typeof useAppActionControllers>;
