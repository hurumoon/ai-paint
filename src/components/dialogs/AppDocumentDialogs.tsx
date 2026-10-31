import { lazy } from "react";
import type {
  AppDialogActions,
  AppDialogSettings,
  AppDialogsDocumentState,
  AppDialogVisibility,
} from "./types";

const CanvasExtendDialog = lazy(() =>
  import("../CanvasExtendDialog").then((module) => ({
    default: module.CanvasExtendDialog,
  }))
);
const ExportDialog = lazy(() =>
  import("../ExportDialog").then((module) => ({ default: module.ExportDialog }))
);
const BackupPanel = lazy(() =>
  import("../BackupPanel").then((module) => ({ default: module.BackupPanel }))
);
const ColorAdjustDialog = lazy(() =>
  import("../ColorAdjustDialog").then((module) => ({
    default: module.ColorAdjustDialog,
  }))
);

type AppDocumentDialogsVisibility = Pick<
  AppDialogVisibility,
  | "showCanvasExtendDialog"
  | "showExportDialog"
  | "showBackupPanel"
  | "showColorAdjustDialog"
>;

type AppDocumentDialogsSettings = Pick<
  AppDialogSettings,
  | "backupIntervalSec"
  | "setBackupIntervalSec"
  | "backupEnabled"
  | "setBackupEnabled"
  | "autoBackup"
>;

type AppDocumentDialogsActions = Pick<
  AppDialogActions,
  | "onCloseCanvasExtendDialog"
  | "onCanvasExtendPreviewChange"
  | "onCloseExportDialog"
  | "onSavedAsProject"
  | "onCloseBackupPanel"
  | "onCloseColorAdjustDialog"
>;

interface AppDocumentDialogsProps {
  documentState: Pick<AppDialogsDocumentState, "doc" | "history" | "selection">;
  visibility: AppDocumentDialogsVisibility;
  settings: AppDocumentDialogsSettings;
  actions: AppDocumentDialogsActions;
}

export function AppDocumentDialogs({
  documentState,
  visibility,
  settings,
  actions,
}: AppDocumentDialogsProps) {
  const { doc, history, selection } = documentState;

  if (!doc || !history) {
    return null;
  }

  return (
    <>
      <CanvasExtendDialog
        open={visibility.showCanvasExtendDialog}
        onClose={actions.onCloseCanvasExtendDialog}
        doc={doc}
        history={history}
        onPreviewChange={actions.onCanvasExtendPreviewChange}
      />
      <ExportDialog
        open={visibility.showExportDialog}
        onClose={actions.onCloseExportDialog}
        doc={doc}
        getHistoryVersion={() => history.getSnapshot()}
        getDocumentVersion={() => doc.getSnapshot()}
        onSavedAsProject={actions.onSavedAsProject}
      />
      <BackupPanel
        open={visibility.showBackupPanel}
        onClose={actions.onCloseBackupPanel}
        controller={settings.autoBackup}
      />
      <ColorAdjustDialog
        open={visibility.showColorAdjustDialog}
        onClose={actions.onCloseColorAdjustDialog}
        doc={doc}
        history={history}
        selection={selection}
      />
    </>
  );
}
