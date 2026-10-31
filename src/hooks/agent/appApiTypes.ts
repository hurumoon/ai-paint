import type { Dispatch, SetStateAction } from "react";
import type { AppActionControllers } from "../useAppActionControllers";
import type { AIController } from "../useAIController";
import type { ChatController } from "../useChatController";
import type { AppCanvasViewState } from "../useCanvasViewState";
import type { EnhancedAISettings } from "../useEnhancedAISettings";
import type { ToolState } from "../useToolState";
import type { Tab, TabStore } from "../useTabs";
import type { LayoutConfig } from "../../core/panelLayout";
import type { ChallengeItem, ShortcutMap, Theme } from "../../types";

export interface AppApiContext {
  tabStore: TabStore;
  actions: AppActionControllers;
  tool: ToolState;
  view: AppCanvasViewState;
  ai: AIController;
  chat: ChatController;
  aiSettings: EnhancedAISettings;
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  shortcuts: ShortcutMap;
  setShortcuts: Dispatch<SetStateAction<ShortcutMap>>;
  challengeItems: ChallengeItem[];
  setChallengeItems: Dispatch<SetStateAction<ChallengeItem[]>>;
  historyMemoryBudget: number;
  setHistoryMemoryBudget: (bytes: number) => void;
  stashAndAddTab: (width?: number, height?: number, dpi?: number) => Tab;
  agentRunning: () => boolean;
  openAgentWorkspace: () => void;
}
