import { useCallback, useState, useSyncExternalStore } from "react";
import { chatWithClaude, expandGuidesToDocSize } from "../core/aiClient";
import { flattenDocumentToBase64ForAI } from "../core/aiImagePayload";
import { retainLatestChatImage } from "../core/chatHistory";
import { openChatWindow, useChatBridge } from "../core/chatWindow";
import { PaintDocument } from "../core/PaintDocument";
import { ChatMessage, GuideShape } from "../types";
import { pushToast } from "../ui/primitives";
import { TabStore, TabUiStatePatch } from "./useTabs";

function newChatId(prefix: string): string {
  const u =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${u}`;
}

interface UseChatControllerOptions {
  activeTabId: string | null;
  tabStore: TabStore;
  hasApiKey: boolean;
  doc: PaintDocument | null;
  setGuides: (guides: GuideShape[]) => void;
  setShowGuides: (show: boolean) => void;
  setPalette: (palette: string[]) => void;
}

export function useChatController({
  activeTabId,
  tabStore,
  hasApiKey,
  doc,
  setGuides,
  setShowGuides,
  setPalette,
}: UseChatControllerOptions) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatAttachCanvas, setChatAttachCanvas] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot);
  // 現在タブは React、背景タブは退避済みの状態を参照する。
  const anyChatLoading = chatLoading || tabStore.tabs.some(
    tab => tab.id !== tabStore.activeTabId && tab.uiState.chatLoading
  );
  const [chatError, setChatError] = useState("");
  const [chatDetached, setChatDetached] = useState(false);

  const applyTabUiStatePatch = useCallback((
    targetTabId: string | null,
    patch: TabUiStatePatch
  ): boolean => {
    if (!targetTabId) return false;
    if (tabStore.activeTabId !== targetTabId) {
      return tabStore.patchTabUiState(targetTabId, patch);
    }
    if (patch.guides !== undefined) setGuides(patch.guides);
    if (patch.showGuides !== undefined) setShowGuides(patch.showGuides);
    if (patch.palette !== undefined) setPalette(patch.palette);
    if (patch.chatMessages !== undefined) setChatMessages(patch.chatMessages);
    if (patch.chatDraft !== undefined) setChatDraft(patch.chatDraft);
    if (patch.chatAttachCanvas !== undefined) setChatAttachCanvas(patch.chatAttachCanvas);
    if (patch.chatLoading !== undefined) setChatLoading(patch.chatLoading);
    if (patch.chatError !== undefined) setChatError(patch.chatError);
    return true;
  }, [setGuides, setPalette, setShowGuides, tabStore]);

  const handleChatSend = useCallback(async (overrideDraft?: string) => {
    const targetTabId = activeTabId;
    if (!hasApiKey) {
      applyTabUiStatePatch(targetTabId, { chatError: "API キーを入れてください" });
      return;
    }
    const source = typeof overrideDraft === "string" ? overrideDraft : chatDraft;
    const text = source.trim();
    if (!text && !chatAttachCanvas) return;

    let imageBase64: string | undefined;
    let imagePreviewUrl: string | undefined;
    let imageSentWidth: number | undefined;
    let imageSentHeight: number | undefined;
    let imageDocWidth: number | undefined;
    let imageDocHeight: number | undefined;
    if (chatAttachCanvas) {
      if (!doc) {
        applyTabUiStatePatch(targetTabId, { chatError: "キャンバスがありません" });
        return;
      }
      try {
        const payload = await flattenDocumentToBase64ForAI(doc);
        imageBase64 = payload.base64;
        imageSentWidth = payload.width;
        imageSentHeight = payload.height;
        imageDocWidth = doc.width;
        imageDocHeight = doc.height;
        imagePreviewUrl = `data:image/png;base64,${imageBase64}`;
      } catch (e) {
        applyTabUiStatePatch(targetTabId, {
          chatError: `キャンバス取得失敗: ${e instanceof Error ? e.message : e}`,
        });
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: newChatId("chat-u"),
      role: "user",
      text,
      imageBase64,
      imageSentWidth,
      imageSentHeight,
      imageDocWidth,
      imageDocHeight,
      imagePreviewUrl,
      timestamp: Date.now(),
    };
    const nextHistory = retainLatestChatImage([...chatMessages, userMsg]);
    if (!applyTabUiStatePatch(targetTabId, {
      chatMessages: nextHistory,
      chatDraft: "",
      chatAttachCanvas: false,
      chatLoading: true,
      chatError: "",
    })) {
      return;
    }

    try {
      const res = await chatWithClaude({ messages: nextHistory });
      const latestImageMsg = [...nextHistory]
        .reverse()
        .find((m) => m.role === "user" && m.imageBase64);
      const refDocW = latestImageMsg?.imageDocWidth ?? doc?.width ?? 0;
      const refDocH = latestImageMsg?.imageDocHeight ?? doc?.height ?? 0;
      const refSentW = latestImageMsg?.imageSentWidth ?? refDocW;
      const refSentH = latestImageMsg?.imageSentHeight ?? refDocH;
      const expandedGuides = expandGuidesToDocSize(
        res.guides,
        refDocW,
        refDocH,
        refSentW,
        refSentH
      );
      const assistantMsg: ChatMessage = {
        id: newChatId("chat-a"),
        role: "assistant",
        text: res.advice,
        guides: expandedGuides.length > 0 ? expandedGuides : undefined,
        palette: res.palette && res.palette.length > 0 ? res.palette : undefined,
        timestamp: Date.now(),
      };
      const responsePatch: TabUiStatePatch = {
        chatMessages: [...nextHistory, assistantMsg],
        chatLoading: false,
      };
      if (expandedGuides.length > 0) {
        responsePatch.guides = expandedGuides;
        responsePatch.showGuides = true;
      }
      if (res.palette && res.palette.length > 0) {
        responsePatch.palette = res.palette;
      }
      applyTabUiStatePatch(targetTabId, responsePatch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applyTabUiStatePatch(targetTabId, {
        chatError: `チャット失敗: ${msg}`,
        chatLoading: false,
      });
      pushToast(`チャット失敗: ${msg}`, "error");
    }
  }, [
    activeTabId,
    applyTabUiStatePatch,
    hasApiKey,
    chatAttachCanvas,
    chatDraft,
    chatMessages,
    doc,
  ]);

  const handleChatClear = useCallback(() => {
    if (chatLoading) return;
    setChatMessages([]);
    setChatError("");
  }, [chatLoading]);

  const handleApplyChatGuides = useCallback((g: GuideShape[]) => {
    setGuides(g);
    setShowGuides(true);
  }, [setGuides, setShowGuides]);

  const handleClearChatGuides = useCallback(() => {
    setGuides([]);
  }, [setGuides]);

  const handleApplyChatPalette = useCallback((p: string[]) => {
    setPalette(p);
  }, [setPalette]);

  useChatBridge({
    isHost: true,
    messages: chatMessages,
    setMessages: setChatMessages,
    draft: chatDraft,
    setDraft: setChatDraft,
    attachCanvas: chatAttachCanvas,
    setAttachCanvas: setChatAttachCanvas,
    isLoading: chatLoading,
    error: chatError,
    hasApiKey,
    detached: chatDetached,
    setDetached: setChatDetached,
    onSend: handleChatSend,
    onClear: handleChatClear,
    onApplyGuides: handleApplyChatGuides,
    onClearGuides: handleClearChatGuides,
    onApplyPalette: handleApplyChatPalette,
  });

  const handleDetachChatWindow = useCallback(async () => {
    try {
      await openChatWindow();
      setChatDetached(true);
    } catch (e) {
      pushToast(`チャットウィンドウを開けません: ${e}`, "error");
    }
  }, []);

  return {
    chatMessages,
    setChatMessages,
    chatDraft,
    setChatDraft,
    chatAttachCanvas,
    setChatAttachCanvas,
    chatLoading,
    anyChatLoading,
    setChatLoading,
    chatError,
    setChatError,
    chatDetached,
    setChatDetached,
    handleChatSend,
    handleChatClear,
    handleApplyChatGuides,
    handleClearChatGuides,
    handleApplyChatPalette,
    handleDetachChatWindow,
  };
}

export type ChatController = ReturnType<typeof useChatController>;
