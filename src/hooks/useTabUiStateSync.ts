import { useCallback, useEffect, useRef } from "react";
import {
  DEFAULT_TAB_UI_STATE,
  Tab,
  TabStore,
  TabUiState,
} from "./useTabs";
import type { AIController } from "./useAIController";
import type { AppCanvasViewState } from "./useCanvasViewState";
import type { ChatController } from "./useChatController";

interface UseTabUiStateSyncOptions {
  activeTab: Tab | null;
  activeTabId: string | null;
  tabStore: TabStore;
  viewState: Pick<
    AppCanvasViewState,
    | "selection"
    | "setSelection"
    | "zoom"
    | "setZoom"
    | "pan"
    | "setPan"
    | "rotation"
    | "setRotation"
    | "canvasFlipped"
    | "setCanvasFlipped"
  >;
  ai: Pick<
    AIController,
    | "guides"
    | "setGuides"
    | "showGuides"
    | "setShowGuides"
    | "palette"
    | "setPalette"
    | "advice"
    | "setAdvice"
    | "error"
    | "setError"
  >;
  chat: Pick<
    ChatController,
    | "chatMessages"
    | "setChatMessages"
    | "chatDraft"
    | "setChatDraft"
    | "chatAttachCanvas"
    | "setChatAttachCanvas"
    | "chatLoading"
    | "setChatLoading"
    | "chatError"
    | "setChatError"
  >;
}

export function useTabUiStateSync({
  activeTab,
  activeTabId,
  tabStore,
  viewState,
  ai,
  chat,
}: UseTabUiStateSyncOptions) {
  const {
  selection,
  setSelection,
  zoom,
  setZoom,
  pan,
  setPan,
  rotation,
  setRotation,
  canvasFlipped,
  setCanvasFlipped,
  } = viewState;
  const {
  guides,
  setGuides,
  showGuides,
  setShowGuides,
  palette,
  setPalette,
  advice,
  setAdvice,
  error,
  setError,
  } = ai;
  const {
  chatMessages,
  setChatMessages,
  chatDraft,
  setChatDraft,
  chatAttachCanvas,
  setChatAttachCanvas,
  chatLoading,
  setChatLoading,
  chatError,
  setChatError,
  } = chat;
  const lastActiveTabIdRef = useRef<string | null>(activeTabId);
  const uiStateLiveRef = useRef<TabUiState>({ ...DEFAULT_TAB_UI_STATE });

  useEffect(() => {
    uiStateLiveRef.current = {
      selection,
      zoom,
      pan,
      rotation,
      canvasFlipped,
      guides,
      showGuides,
      palette,
      advice,
      error,
      chatMessages,
      chatDraft,
      chatAttachCanvas,
      chatLoading,
      chatError,
    };
  });

  useEffect(() => {
    if (lastActiveTabIdRef.current === activeTabId) return;
    const prevId = lastActiveTabIdRef.current;
    if (prevId !== null) {
      tabStore.setTabUiState(prevId, uiStateLiveRef.current);
    }
    const next = activeTab?.uiState ?? DEFAULT_TAB_UI_STATE;
    setSelection(next.selection);
    setZoom(next.zoom);
    setPan(next.pan);
    setRotation(next.rotation);
    setCanvasFlipped(next.canvasFlipped);
    setGuides(next.guides);
    setShowGuides(next.showGuides);
    setPalette(next.palette);
    setAdvice(next.advice);
    setError(next.error);
    setChatMessages(next.chatMessages);
    setChatDraft(next.chatDraft);
    setChatAttachCanvas(next.chatAttachCanvas);
    setChatLoading(next.chatLoading);
    setChatError(next.chatError);
    lastActiveTabIdRef.current = activeTabId;
  }, [
    activeTabId,
    activeTab,
    setAdvice,
    setChatAttachCanvas,
    setChatDraft,
    setChatError,
    setChatLoading,
    setChatMessages,
    setCanvasFlipped,
    setError,
    setGuides,
    setPalette,
    setPan,
    setRotation,
    setSelection,
    setShowGuides,
    setZoom,
    tabStore,
  ]);

  const stashAndAddTab = useCallback(
    (w?: number, h?: number, dpi?: number): Tab => {
      if (tabStore.activeTabId !== null) {
        tabStore.setTabUiState(tabStore.activeTabId, uiStateLiveRef.current);
      }
      const newTab = tabStore.addBlankTab(w, h, dpi);
      setSelection(DEFAULT_TAB_UI_STATE.selection);
      setGuides(DEFAULT_TAB_UI_STATE.guides);
      setShowGuides(DEFAULT_TAB_UI_STATE.showGuides);
      setPalette(DEFAULT_TAB_UI_STATE.palette);
      setAdvice(DEFAULT_TAB_UI_STATE.advice);
      setError(DEFAULT_TAB_UI_STATE.error);
      setZoom(DEFAULT_TAB_UI_STATE.zoom);
      setPan(DEFAULT_TAB_UI_STATE.pan);
      setRotation(DEFAULT_TAB_UI_STATE.rotation);
      setCanvasFlipped(DEFAULT_TAB_UI_STATE.canvasFlipped);
      setChatMessages(DEFAULT_TAB_UI_STATE.chatMessages);
      setChatDraft(DEFAULT_TAB_UI_STATE.chatDraft);
      setChatAttachCanvas(DEFAULT_TAB_UI_STATE.chatAttachCanvas);
      setChatLoading(DEFAULT_TAB_UI_STATE.chatLoading);
      setChatError(DEFAULT_TAB_UI_STATE.chatError);
      lastActiveTabIdRef.current = newTab.id;
      return newTab;
    },
    [
      setAdvice,
      setChatAttachCanvas,
      setChatDraft,
      setChatError,
      setChatLoading,
      setChatMessages,
      setCanvasFlipped,
      setError,
      setGuides,
      setPalette,
      setPan,
      setRotation,
      setSelection,
      setShowGuides,
      setZoom,
      tabStore,
    ]
  );

  return { stashAndAddTab };
}
