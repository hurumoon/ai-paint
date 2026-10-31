import { useMemo, useState } from "react";

export function useAppDialogs() {
  const [showShortcutSettings, setShowShortcutSettings] = useState(false);
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);
  const [showCanvasExtendDialog, setShowCanvasExtendDialog] = useState(false);
  const [showLayoutSettings, setShowLayoutSettings] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showDrawingGuide, setShowDrawingGuide] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [showNewCanvasDialog, setShowNewCanvasDialog] = useState(false);
  const [showColorAdjustDialog, setShowColorAdjustDialog] = useState(false);

  // ダイアログは active タブの doc / selection を参照しながら表示中なので、
  // タブ切替やファイル読込で doc が入れ替わると内部状態が壊れる可能性がある。
  const anyDialogOpen = useMemo(
    () =>
      showColorAdjustDialog ||
      showCanvasSettings ||
      showCanvasExtendDialog ||
      showLayoutSettings ||
      showExportDialog ||
      showBackupPanel ||
      showNewCanvasDialog ||
      showShortcutSettings ||
      showAboutDialog,
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

  return {
    showShortcutSettings,
    setShowShortcutSettings,
    showCanvasSettings,
    setShowCanvasSettings,
    showCanvasExtendDialog,
    setShowCanvasExtendDialog,
    showLayoutSettings,
    setShowLayoutSettings,
    showAboutDialog,
    setShowAboutDialog,
    showDrawingGuide,
    setShowDrawingGuide,
    showExportDialog,
    setShowExportDialog,
    showBackupPanel,
    setShowBackupPanel,
    showNewCanvasDialog,
    setShowNewCanvasDialog,
    showColorAdjustDialog,
    setShowColorAdjustDialog,
    anyDialogOpen,
  };
}

export type AppDialogsController = ReturnType<typeof useAppDialogs>;
