import { useCallback, useMemo } from "react";
import type { AppChromeMenuModel } from "../../components/AppChrome";
import type { UseAppChromeModelParams } from "./types";

export function useAppMenuModel({
  app,
  activeDocument,
  view,
  layout,
  dialogs,
  actions,
}: UseAppChromeModelParams): AppChromeMenuModel {
  const { theme, toggleTheme, hasActiveTab } = app;
  const {
    doc,
    history,
    currentFileName,
    currentFilePath,
    canUndo,
    canRedo,
  } = activeDocument;
  const {
    rotation,
    canvasFlipped,
    showSubview,
    setShowSubview,
    showReference,
    setShowReference,
  } = view.viewState;
  const {
    rotationStep,
    setRotationStep,
    rotateViewClockwise,
    rotateViewCounterClockwise,
    toggleHorizontalFlip,
  } = view.viewCommands;
  const {
    showDrawingGuide,
    setShowAboutDialog,
    setShowCanvasSettings,
    setShowCanvasExtendDialog,
    setShowDrawingGuide,
    setShowColorAdjustDialog,
    setShowLayoutSettings,
    setShowShortcutSettings,
    setShowBackupPanel,
  } = dialogs;
  const { fileActions, exportActions, newCanvasActions } = actions;
  const {
    fileInputRef,
    directImageInputRef,
    handleOpenImage,
    handleOpenDirectImage,
    handleImageFile,
    handleDirectImageFile,
    handleSave,
  } = fileActions;
  const { handleExport } = exportActions;
  const { handleOpenNewCanvasDialog } = newCanvasActions;

  const onUndo = useCallback(() => {
    if (history && doc) history.undo(doc);
  }, [doc, history]);

  const onRedo = useCallback(() => {
    if (history && doc) history.redo(doc);
  }, [doc, history]);

  return useMemo<AppChromeMenuModel>(
    () => ({
      theme,
      hasActiveTab,
      currentFileName,
      currentFilePath,
      fileInputRef,
      directImageInputRef,
      canUndo,
      canRedo,
      rotation,
      rotationStep,
      canvasFlipped,
      showSubview,
      showReference,
      showDrawingGuide,
      topBarLeftItems: layout.topBarLeftItems,
      topBarRightItems: layout.topBarRightItems,
      onShowAboutDialog: () => setShowAboutDialog(true),
      onShowCanvasSettings: () => setShowCanvasSettings(true),
      onShowCanvasExtendDialog: () => setShowCanvasExtendDialog(true),
      onOpenNewCanvasDialog: handleOpenNewCanvasDialog,
      onOpenImage: handleOpenImage,
      onOpenDirectImage: handleOpenDirectImage,
      onImageFile: handleImageFile,
      onDirectImageFile: handleDirectImageFile,
      onUndo,
      onRedo,
      onChangeRotationStep: setRotationStep,
      onRotateViewCounterClockwise: rotateViewCounterClockwise,
      onRotateViewClockwise: rotateViewClockwise,
      onToggleHorizontalFlip: toggleHorizontalFlip,
      onToggleSubview: () => setShowSubview((v) => !v),
      onToggleReference: () => setShowReference((v) => !v),
      onToggleDrawingGuide: () => setShowDrawingGuide((v) => !v),
      onShowColorAdjustDialog: () => setShowColorAdjustDialog(true),
      onShowLayoutSettings: () => setShowLayoutSettings(true),
      onShowShortcutSettings: () => setShowShortcutSettings(true),
      onSave: () => void handleSave(),
      onExport: handleExport,
      onShowBackupPanel: () => setShowBackupPanel(true),
      onToggleTheme: toggleTheme,
    }),
    [
      canRedo,
      canUndo,
      canvasFlipped,
      currentFileName,
      currentFilePath,
      directImageInputRef,
      fileInputRef,
      handleDirectImageFile,
      handleExport,
      handleImageFile,
      handleOpenDirectImage,
      handleOpenImage,
      handleOpenNewCanvasDialog,
      handleSave,
      hasActiveTab,
      layout.topBarLeftItems,
      layout.topBarRightItems,
      onRedo,
      onUndo,
      rotateViewClockwise,
      rotateViewCounterClockwise,
      rotation,
      rotationStep,
      setRotationStep,
      setShowAboutDialog,
      setShowBackupPanel,
      setShowCanvasExtendDialog,
      setShowCanvasSettings,
      setShowColorAdjustDialog,
      setShowDrawingGuide,
      setShowLayoutSettings,
      setShowReference,
      setShowShortcutSettings,
      setShowSubview,
      showDrawingGuide,
      showReference,
      showSubview,
      theme,
      toggleHorizontalFlip,
      toggleTheme,
    ]
  );
}
