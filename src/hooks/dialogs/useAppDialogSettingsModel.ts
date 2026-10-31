import { useMemo } from "react";
import type { AppDialogSettings } from "../../components/dialogs/types";
import type { AppActionControllers } from "../useAppActionControllers";
import type { AppCanvasViewState } from "../useCanvasViewState";
import type { AIController } from "../useAIController";
import type { EnhancedAISettings } from "../useEnhancedAISettings";
import type { ToolState } from "../useToolState";

export interface UseAppDialogSettingsModelParams {
  settings: {
    shortcuts: AppDialogSettings["shortcuts"];
    setShortcuts: AppDialogSettings["setShortcuts"];
    historyMemoryBudget: AppDialogSettings["historyMemoryBudget"];
    onChangeHistoryMemoryBudget: AppDialogSettings["onChangeHistoryMemoryBudget"];
    layout: AppDialogSettings["layout"];
    setLayout: AppDialogSettings["setLayout"];
    aiSettings: EnhancedAISettings;
    aiAuth: Pick<AIController, "hasApiKey" | "setApiKey" | "clearApiKey">;
    challengeItems: AppDialogSettings["challengeItems"];
    onChangeChallengeItems: AppDialogSettings["onChangeChallengeItems"];
  };
  viewState: Pick<AppCanvasViewState, "grid" | "setGrid">;
  toolState: ToolState;
  actions: AppActionControllers;
}

export function useAppDialogSettingsModel({
  settings: dialogSettings,
  viewState,
  toolState,
  actions: appActions,
}: UseAppDialogSettingsModelParams): AppDialogSettings {
  const {
    shortcuts,
    setShortcuts,
    historyMemoryBudget,
    onChangeHistoryMemoryBudget,
    layout,
    setLayout,
    aiSettings,
    aiAuth,
    challengeItems,
    onChangeChallengeItems,
  } = dialogSettings;
  const { grid, setGrid } = viewState;
  const {
    enhancedAIEnabled,
    setEnhancedAIEnabled,
    aiGuideDisplayMode,
    setAIGuideDisplayMode,
  } = aiSettings;
  const {
    colorHistoryConfig,
    setColorHistoryConfig,
  } = toolState;
  const {
    backupIntervalSec,
    setBackupIntervalSec,
    backupEnabled,
    setBackupEnabled,
  } = appActions.autoBackup;

  return useMemo<AppDialogSettings>(
    () => ({
      shortcuts,
      setShortcuts,
      historyMemoryBudget,
      onChangeHistoryMemoryBudget,
      enhancedAIEnabled,
      setEnhancedAIEnabled,
      aiGuideDisplayMode,
      setAIGuideDisplayMode,
      hasApiKey: aiAuth.hasApiKey,
      setApiKey: aiAuth.setApiKey,
      clearApiKey: aiAuth.clearApiKey,
      challengeItems,
      onChangeChallengeItems,
      colorHistoryConfig,
      onChangeColorHistoryConfig: setColorHistoryConfig,
      grid,
      setGrid,
      layout,
      setLayout,
      backupIntervalSec,
      setBackupIntervalSec,
      backupEnabled,
      setBackupEnabled,
      autoBackup: appActions.autoBackup,
    }),
    [
      aiGuideDisplayMode,
      appActions.autoBackup,
      aiAuth.clearApiKey,
      aiAuth.hasApiKey,
      aiAuth.setApiKey,
      backupEnabled,
      backupIntervalSec,
      challengeItems,
      colorHistoryConfig,
      grid,
      enhancedAIEnabled,
      historyMemoryBudget,
      layout,
      onChangeChallengeItems,
      onChangeHistoryMemoryBudget,
      setAIGuideDisplayMode,
      setBackupEnabled,
      setBackupIntervalSec,
      setColorHistoryConfig,
      setEnhancedAIEnabled,
      setGrid,
      setLayout,
      setShortcuts,
      shortcuts,
    ]
  );
}
