import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react";
import { AppCanvasArea } from "./components/AppCanvasArea";
import { AppDialogs } from "./components/AppDialogs";
import { AppDropOverlay, AppLoadingOverlay } from "./components/AppOverlays";
import { AppChrome } from "./components/AppChrome";
import { AppStatusBar } from "./components/AppStatusBar";
import { NativeSmokeReadySignal } from "./components/NativeSmokeReadySignal";
import { StartupSplash } from "./components/StartupSplash";
import { useTabs } from "./hooks/useTabs";
import { useTheme } from "./hooks/useTheme";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useTabUiStateSync } from "./hooks/useTabUiStateSync";
import { useCanvasViewState } from "./hooks/useCanvasViewState";
import { useCanvasViewCommands } from "./hooks/useCanvasViewCommands";
import { useActiveTabDocument } from "./hooks/useActiveTabDocument";
import { useChallengeItems } from "./hooks/useChallengeItems";
import { useAppAIChatControllers } from "./hooks/useAppAIChatControllers";
import { useAppActionControllers } from "./hooks/useAppActionControllers";
import { useAppCanvasAreaModel } from "./hooks/useAppCanvasAreaModel";
import { useAppChromeModel } from "./hooks/useAppChromeModel";
import { useAppDialogModel } from "./hooks/useAppDialogModel";
import { useAppDialogs } from "./hooks/useAppDialogs";
import { useAppPanelModel } from "./hooks/useAppPanelModel";
import { useAppStatusBarModel } from "./hooks/useAppStatusBarModel";
import { useAppViewModel } from "./hooks/useAppViewModel";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useDocumentTitleSync } from "./hooks/useDocumentTitleSync";
import { useWindowCloseGuard } from "./hooks/useWindowCloseGuard";
import {
  usePaintToolOptions,
  useToolState,
} from "./hooks/useToolState";
import {
  useHistoryMemoryBudget,
  useSyncHistoryMemoryBudget,
} from "./hooks/useHistoryMemoryBudget";
import { useEnhancedAISettings } from "./hooks/useEnhancedAISettings";
import {
  CanvasExtendPreview,
  TextLayerData,
} from "./types";
import { ToastHost } from "./ui/primitives";
import { loadShortcuts } from "./core/shortcuts";
import { useDrawingAgent } from "./hooks/agent/useDrawingAgent";
import { useAgentInteractionLock } from "./hooks/agent/useAgentInteractionLock";

const AppPanels = lazy(() =>
  import("./components/AppPanels").then((module) => ({ default: module.AppPanels }))
);

const DEFAULT_TEXT_STYLE: TextLayerData = {
  text: "テキスト",
  fontFamily: "sans-serif",
  fontSize: 48,
  color: "#222222",
  bold: false,
  italic: false,
  align: "left",
  x: 100,
  y: 100,
  lineHeight: 1.2,
};

function App() {
  const { theme, setTheme, toggleTheme } = useTheme();
  const [aiDrawFocusRequest, setAiDrawFocusRequest] = useState(0);
  const [agentPending, setAgentPending] = useState(false);
  const [agentPlayback, setAgentPlayback] = useState<{ tabId: string | null; index: number } | null>(null);
  const agentRunningRef = useRef(false);

  const [historyMemoryBudget, setHistoryMemoryBudget] = useHistoryMemoryBudget();
  // タブ集合と active タブ。各タブは独自の doc / history / timelapse を持つ。
  // タブ 0 個の状態を許容するため、activeTab / doc / history / timelapse は
  // null になり得る。null の時は中央プレースホルダー UI を描画する。
  const { store: tabStore, tabs, activeTab, activeTabId } = useTabs(historyMemoryBudget);
  const activeDocument = useActiveTabDocument(activeTab);
  const { doc, history, currentFileName, isDirty } = activeDocument;
  const hasActiveTab = Boolean(activeTab);
  useSyncHistoryMemoryBudget(historyMemoryBudget, tabStore);

  // ===== ツール =====
  const toolState = useToolState();
  const { toolOptionsOpen } = toolState;
  // ===== 表示 =====
  const viewState = useCanvasViewState();
  const { toolOptionsProps, canvasToolProps } = usePaintToolOptions(
    toolState,
    viewState.selection,
    viewState.setSelection
  );
  const viewCommands = useCanvasViewCommands({
    setRotation: viewState.setRotation,
    setCanvasFlipped: viewState.setCanvasFlipped,
  });

  // ===== ショートカット =====
  const [shortcuts, setShortcuts] = useState(() => loadShortcuts());
  const { challengeItems, setChallengeItems } = useChallengeItems();
  const dialogs = useAppDialogs();

  const { layout, setLayout } = usePanelLayout();
  const aiSettings = useEnhancedAISettings({ layout });
  const { enhancedAIEnabled, visibleLayout } = aiSettings;
  const aiDrawVisible = visibleLayout.leftSections.includes("aiDraw") || visibleLayout.rightSections.includes("aiDraw");
  const [canvasExtendPreview, setCanvasExtendPreview] =
    useState<CanvasExtendPreview | null>(null);

  // ===== AI =====
  const { ai, chat } = useAppAIChatControllers({
    activeTab,
    activeTabId,
    tabStore,
    doc,
    selection: viewState.selection,
    enhancedAIEnabled,
  });

  // ===== テキストレイヤー編集 =====
  const [defaultTextStyle, setDefaultTextStyle] = useState<TextLayerData>(DEFAULT_TEXT_STYLE);

  const { stashAndAddTab } = useTabUiStateSync({
    activeTab,
    activeTabId,
    tabStore,
    viewState,
    ai,
    chat,
  });

  const { setShowExportDialog, setShowNewCanvasDialog } = dialogs;
  const openExportDialog = useCallback(() => {
    setShowExportDialog(true);
  }, [setShowExportDialog]);
  const openNewCanvasDialog = useCallback(() => {
    setShowNewCanvasDialog(true);
  }, [setShowNewCanvasDialog]);

  const actions = useAppActionControllers({
    activeTab,
    tabStore,
    activeDocument,
    anyDialogOpen: dialogs.anyDialogOpen,
    chatLoading: chat.anyChatLoading,
    aiLoading: ai.isLoading || ai.isChallengeScoring,
    stashAndAddTab,
    openExportDialog,
    openNewCanvasDialog,
    setDefaultTextStyle,
  });
  const { fileActions, newCanvasActions, tabActions } = actions;
  const drawingAgent = useDrawingAgent({
    tabStore, actions, tool: toolState, view: viewState, ai, chat, aiSettings,
    layout, setLayout, theme, setTheme, shortcuts, setShortcuts,
    challengeItems, setChallengeItems,
    historyMemoryBudget, setHistoryMemoryBudget, stashAndAddTab,
    agentRunning: () => agentRunningRef.current,
    openAgentWorkspace: () => {
      setAgentPlayback(null);
      if (!aiDrawVisible) setLayout({ ...layout, hidden: layout.hidden.filter(id => id !== "aiDraw"), rightSections: [...layout.rightSections, "aiDraw"] });
      setAiDrawFocusRequest(request => request + 1);
    },
  });
  agentRunningRef.current = drawingAgent.state.status === "running" || drawingAgent.state.settling;
  const playbackIndex = aiDrawVisible && !agentRunningRef.current && agentPlayback?.tabId === activeTabId ? agentPlayback.index : null;
  const agentBusy = agentRunningRef.current || agentPending || playbackIndex !== null;
  const handlePlaybackChange = useCallback((index: number | null) => setAgentPlayback(index === null ? null : { tabId: activeTabId, index }), [activeTabId]);
  useAgentInteractionLock(agentBusy);

  useDocumentTitleSync({
    currentFileName,
    hasActiveTab,
    isDirty,
  });
  useWindowCloseGuard({ tabStore });
  // ===== キーボードショートカット =====
  useAppShortcuts({
    disabled: agentBusy,
    shortcuts,
    activeTabId,
    doc,
    history,
    toolState,
    savingRef: fileActions.savingRef,
    paintBusyRef: fileActions.paintBusyRef,
    showColorAdjustDialog: dialogs.showColorAdjustDialog,
    setShowColorAdjustDialog: dialogs.setShowColorAdjustDialog,
    setSelection: viewState.setSelection,
    setGrid: viewState.setGrid,
    setZoom: viewState.setZoom,
    setPan: viewState.setPan,
    setRotation: viewState.setRotation,
    setCanvasFlipped: viewState.setCanvasFlipped,
    handleSave: fileActions.handleSave,
    handleSaveAs: fileActions.handleSaveAs,
    handleOpenImage: fileActions.handleOpenImage,
    handleOpenNewCanvasDialog: newCanvasActions.handleOpenNewCanvasDialog,
    handleCloseTab: tabActions.handleCloseTab,
    rotateViewClockwise: viewCommands.rotateViewClockwise,
    rotateViewCounterClockwise: viewCommands.rotateViewCounterClockwise,
    toggleHorizontalFlip: viewCommands.toggleHorizontalFlip,
  });

  const chromeModel = useAppChromeModel({
    app: { theme, toggleTheme, hasActiveTab },
    tabs: { tabs, activeTabId },
    activeDocument,
    tool: { toolState, toolOptionsProps },
    view: { viewState, viewCommands },
    layout,
    dialogs,
    actions,
  });
  const canvasAreaProps = useAppCanvasAreaModel({
    agentBusy,
    hasActiveTab,
    activeDocument,
    canvasToolProps,
    viewState,
    shortcuts,
    dialogs,
    aiSettings,
    challengeItems,
    defaultTextStyle,
    canvasExtendPreview,
    ai,
    actions,
    toolState,
  });
  const panelModel = useAppPanelModel({
    activeDocument,
    viewState,
    textLayerActions: actions.textLayerActions,
    ai,
    chat,
    toolState,
    drawState: {
      documentKey: `${activeTabId}-${drawingAgent.restoreGeneration}`, controller: drawingAgent,
      hasDocument: hasActiveTab, focusRequest: aiDrawFocusRequest, playbackIndex,
      onPlaybackChange: handlePlaybackChange, onBusyChange: setAgentPending,
      claudeAuth: { configured: ai.hasApiKey, setKey: ai.setApiKey, clearKey: ai.clearApiKey },
    },
  });
  const statusBarProps = useAppStatusBarModel({
    activeDocument,
    viewState,
    toolState,
  });
  const dialogModel = useAppDialogModel({
    activeDocument,
    viewState,
    dialogs,
    settings: {
      shortcuts,
      setShortcuts,
      historyMemoryBudget,
      onChangeHistoryMemoryBudget: setHistoryMemoryBudget,
      layout,
      setLayout,
      aiSettings,
      aiAuth: {
        hasApiKey: ai.hasApiKey,
        setApiKey: ai.setApiKey,
        clearApiKey: ai.clearApiKey,
      },
      challengeItems,
      onChangeChallengeItems: setChallengeItems,
      setCanvasExtendPreview,
    },
    toolState,
    actions,
  });
  const appViewModel = useAppViewModel({
    chromeModel,
    canvasAreaProps,
    panelModel,
    statusBarProps,
    dialogModel,
  });

  return (
    <>
      <Suspense fallback={<AppLoadingOverlay label="パネルを読み込み中..." progress={88} />}>
        <div
          className={`app ${layout.flipped ? "layout-flipped" : ""} ${
            visibleLayout.leftSections.length > 0 ? "has-left-panel" : ""
          } ${visibleLayout.rightSections.length > 0 ? "has-right-panel" : ""} ${agentBusy ? "agent-working" : ""} ${
            toolOptionsOpen ? "has-tool-options" : ""
          } ${fileActions.isDragOver ? "is-dragover" : ""}`}
          onDragEnter={event => { if (!agentBusy) fileActions.handleDragEnter(event); }}
          onDragOver={fileActions.handleDragOver}
          onDragLeave={fileActions.handleDragLeave}
          onDrop={event => { if (agentBusy) { event.preventDefault(); return; } fileActions.handleDrop(event); }}
        >
          <AppChrome {...appViewModel.chromeModel} />

          <AppCanvasArea {...appViewModel.canvasAreaProps} canvasOverlayState={{ ...appViewModel.canvasAreaProps.canvasOverlayState,
            replayFrame: playbackIndex === null ? undefined : drawingAgent.agent.getPreviewFrame(playbackIndex) }} />

          <AppPanels
            layout={visibleLayout}
            panelModel={appViewModel.panelModel}
          />

          <AppStatusBar {...appViewModel.statusBarProps} editingDisabled={agentBusy} />

          {fileActions.isDragOver && <AppDropOverlay />}

          {fileActions.loadingFileName && (
            <AppLoadingOverlay label="読み込み中..." subLabel={fileActions.loadingFileName} />
          )}

          {fileActions.savingFileName && (
            <AppLoadingOverlay label="保存中..." subLabel={fileActions.savingFileName} busy />
          )}

          <ToastHost />

          <AppDialogs {...appViewModel.dialogModel} />
        </div>
        <NativeSmokeReadySignal />
      </Suspense>
      <StartupSplash />
    </>
  );
}

export default App;
