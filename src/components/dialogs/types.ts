import type { Dispatch, SetStateAction } from "react";
import type { GridConfig } from "../GridSettings";
import type { ColorHistoryConfig } from "../../core/colorHistory";
import type { History } from "../../core/History";
import type { LayoutConfig } from "../../core/panelLayout";
import type { PaintDocument } from "../../core/PaintDocument";
import type { AutoBackupController } from "../../hooks/useAutoBackupController";
import type {
  AIGuideDisplayMode,
  CanvasExtendPreview,
  ChallengeItem,
  Selection,
  ShortcutMap,
} from "../../types";

export interface AppDialogsDocumentState {
  doc: PaintDocument | null;
  history: History | null;
  selection: Selection;
  isDirty: boolean;
}

export interface AppDialogVisibility {
  showAboutDialog: boolean;
  showShortcutSettings: boolean;
  showCanvasSettings: boolean;
  showCanvasExtendDialog: boolean;
  showLayoutSettings: boolean;
  showExportDialog: boolean;
  showBackupPanel: boolean;
  showNewCanvasDialog: boolean;
  showColorAdjustDialog: boolean;
}

export interface AppDialogSettings {
  shortcuts: ShortcutMap;
  setShortcuts: Dispatch<SetStateAction<ShortcutMap>>;
  historyMemoryBudget: number;
  onChangeHistoryMemoryBudget: (bytes: number) => void;
  enhancedAIEnabled: boolean;
  setEnhancedAIEnabled: (enabled: boolean) => void;
  aiGuideDisplayMode: AIGuideDisplayMode;
  setAIGuideDisplayMode: (mode: AIGuideDisplayMode) => void;
  hasApiKey: boolean;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  challengeItems: ChallengeItem[];
  onChangeChallengeItems: (items: ChallengeItem[]) => void;
  colorHistoryConfig: ColorHistoryConfig;
  onChangeColorHistoryConfig: Dispatch<SetStateAction<ColorHistoryConfig>>;
  grid: GridConfig;
  setGrid: (grid: GridConfig) => void;
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
  backupIntervalSec: number;
  setBackupIntervalSec: (value: number) => void;
  backupEnabled: boolean;
  setBackupEnabled: (value: boolean) => void;
  autoBackup: AutoBackupController;
}

export interface AppDialogActions {
  onCloseAboutDialog: () => void;
  onCloseShortcutSettings: () => void;
  onCloseCanvasSettings: () => void;
  onCloseCanvasExtendDialog: () => void;
  onCanvasExtendPreviewChange: (preview: CanvasExtendPreview | null) => void;
  onClearColorHistory: () => void;
  onCloseLayoutSettings: () => void;
  onCloseExportDialog: () => void;
  onSavedAsProject: (
    fileName: string,
    path: string | undefined,
    historyVersionAtSave: number,
    documentVersionAtSave: number,
  ) => void;
  onCloseBackupPanel: () => void;
  onCloseNewCanvasDialog: () => void;
  onNewCanvasConfirm: (width: number, height: number, dpi: number) => void;
  onCloseColorAdjustDialog: () => void;
}

export interface AppDialogsModel {
  documentState: AppDialogsDocumentState;
  visibility: AppDialogVisibility;
  settings: AppDialogSettings;
  actions: AppDialogActions;
}
