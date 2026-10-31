import { useMemo } from "react";
import type { AppPanelsChatState } from "../../components/panels/types";
import type { ChatController } from "../useChatController";

interface UseChatPanelModelParams {
  chat: ChatController;
}

export function useChatPanelModel({
  chat,
}: UseChatPanelModelParams): AppPanelsChatState {
  const {
    chatDetached,
    chatMessages,
    chatLoading,
    chatError,
    chatDraft,
    setChatDraft,
    chatAttachCanvas,
    setChatAttachCanvas,
    handleChatSend,
    handleChatClear,
    handleApplyChatGuides,
    handleClearChatGuides,
    handleApplyChatPalette,
    handleDetachChatWindow,
  } = chat;

  return useMemo<AppPanelsChatState>(
    () => ({
      chatDetached,
      chatMessages,
      chatLoading,
      chatError,
      chatDraft,
      setChatDraft,
      chatAttachCanvas,
      setChatAttachCanvas,
      onChatSend: handleChatSend,
      onChatClear: handleChatClear,
      onApplyChatGuides: handleApplyChatGuides,
      onClearChatGuides: handleClearChatGuides,
      onApplyChatPalette: handleApplyChatPalette,
      onDetachChatWindow: handleDetachChatWindow,
    }),
    [
      chatAttachCanvas,
      chatDetached,
      chatDraft,
      chatError,
      chatLoading,
      chatMessages,
      handleApplyChatGuides,
      handleClearChatGuides,
      handleApplyChatPalette,
      handleChatClear,
      handleChatSend,
      handleDetachChatWindow,
      setChatAttachCanvas,
      setChatDraft,
    ]
  );
}
