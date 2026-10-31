import { useMemo } from "react";
import type { AppPanelModel } from "../components/panels/types";
import { useAIPanelModel } from "./panels/useAIPanelModel";
import { useChatPanelModel } from "./panels/useChatPanelModel";
import { useDocumentPanelModel } from "./panels/useDocumentPanelModel";
import { useViewPanelModel } from "./panels/useViewPanelModel";
import type { AppActionControllers } from "./useAppActionControllers";
import type { ActiveTabDocumentState } from "./useActiveTabDocument";
import type { AIController } from "./useAIController";
import type { AppCanvasViewState } from "./useCanvasViewState";
import type { ChatController } from "./useChatController";
import type { ToolState } from "./useToolState";

interface UseAppPanelModelParams {
  activeDocument: ActiveTabDocumentState;
  viewState: AppCanvasViewState;
  textLayerActions: AppActionControllers["textLayerActions"];
  ai: AIController;
  chat: ChatController;
  toolState: ToolState;
  drawState: AppPanelModel["drawState"];
}

export function useAppPanelModel({
  activeDocument,
  viewState,
  textLayerActions,
  ai,
  chat,
  toolState,
  drawState,
}: UseAppPanelModelParams): AppPanelModel {
  const documentState = useDocumentPanelModel({
    activeDocument,
    textLayerActions,
  });
  const viewPanelState = useViewPanelModel({ viewState });
  const chatState = useChatPanelModel({ chat });
  const aiState = useAIPanelModel({
    ai,
    anyChatLoading: chat.anyChatLoading,
    selection: viewState.selection,
    setHighlightGuide: viewState.setHighlightGuide,
    setColor: toolState.setColor,
  });

  return useMemo<AppPanelModel>(
    () => ({
      documentState,
      viewState: viewPanelState,
      chatState,
      aiState,
      drawState,
    }),
    [aiState, chatState, documentState, viewPanelState, drawState]
  );
}
