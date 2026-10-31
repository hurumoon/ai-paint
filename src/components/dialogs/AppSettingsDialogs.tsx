import { lazy } from "react";
import type {
  AppDialogActions,
  AppDialogSettings,
  AppDialogsDocumentState,
  AppDialogVisibility,
} from "./types";

const ShortcutSettings = lazy(() =>
  import("../ShortcutSettings").then((module) => ({ default: module.ShortcutSettings }))
);
const LayoutSettings = lazy(() =>
  import("../LayoutSettings").then((module) => ({ default: module.LayoutSettings }))
);
const CanvasSettings = lazy(() =>
  import("../CanvasSettings").then((module) => ({ default: module.CanvasSettings }))
);

type AppSettingsDialogsVisibility = Pick<
  AppDialogVisibility,
  "showShortcutSettings" | "showLayoutSettings" | "showCanvasSettings"
>;

type AppSettingsDialogsSettings = Pick<
  AppDialogSettings,
  | "shortcuts"
  | "setShortcuts"
  | "layout"
  | "setLayout"
  | "historyMemoryBudget"
  | "onChangeHistoryMemoryBudget"
  | "enhancedAIEnabled"
  | "setEnhancedAIEnabled"
  | "aiGuideDisplayMode"
  | "setAIGuideDisplayMode"
  | "hasApiKey"
  | "setApiKey"
  | "clearApiKey"
  | "challengeItems"
  | "onChangeChallengeItems"
  | "colorHistoryConfig"
  | "onChangeColorHistoryConfig"
  | "grid"
  | "setGrid"
  | "backupIntervalSec"
  | "setBackupIntervalSec"
  | "backupEnabled"
  | "setBackupEnabled"
>;

type AppSettingsDialogsActions = Pick<
  AppDialogActions,
  | "onCloseShortcutSettings"
  | "onCloseLayoutSettings"
  | "onCloseCanvasSettings"
  | "onClearColorHistory"
>;

interface AppSettingsDialogsProps {
  documentState: Pick<AppDialogsDocumentState, "doc" | "history">;
  visibility: AppSettingsDialogsVisibility;
  settings: AppSettingsDialogsSettings;
  actions: AppSettingsDialogsActions;
}

export function AppSettingsDialogs({
  documentState,
  visibility,
  settings,
  actions,
}: AppSettingsDialogsProps) {
  const { doc, history } = documentState;

  return (
    <>
      <ShortcutSettings
        open={visibility.showShortcutSettings}
        onClose={actions.onCloseShortcutSettings}
        shortcuts={settings.shortcuts}
        setShortcuts={settings.setShortcuts}
      />
      <LayoutSettings
        open={visibility.showLayoutSettings}
        onClose={actions.onCloseLayoutSettings}
        layout={settings.layout}
        setLayout={settings.setLayout}
      />
      {doc && history && (
        <CanvasSettings
          open={visibility.showCanvasSettings}
          onClose={actions.onCloseCanvasSettings}
          doc={doc}
          history={history}
          historyMemoryBudget={settings.historyMemoryBudget}
          onChangeHistoryMemoryBudget={settings.onChangeHistoryMemoryBudget}
          enhancedAIEnabled={settings.enhancedAIEnabled}
          setEnhancedAIEnabled={settings.setEnhancedAIEnabled}
          aiGuideDisplayMode={settings.aiGuideDisplayMode}
          setAIGuideDisplayMode={settings.setAIGuideDisplayMode}
          hasApiKey={settings.hasApiKey}
          setApiKey={settings.setApiKey}
          clearApiKey={settings.clearApiKey}
          challengeItems={settings.challengeItems}
          onChangeChallengeItems={settings.onChangeChallengeItems}
          colorHistoryConfig={settings.colorHistoryConfig}
          onChangeColorHistoryConfig={settings.onChangeColorHistoryConfig}
          onClearColorHistory={actions.onClearColorHistory}
          shortcuts={settings.shortcuts}
          setShortcuts={settings.setShortcuts}
          layout={settings.layout}
          setLayout={settings.setLayout}
          grid={settings.grid}
          setGrid={settings.setGrid}
          backupIntervalSec={settings.backupIntervalSec}
          setBackupIntervalSec={settings.setBackupIntervalSec}
          backupEnabled={settings.backupEnabled}
          setBackupEnabled={settings.setBackupEnabled}
        />
      )}
    </>
  );
}
