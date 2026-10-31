import type { ReactNode } from "react";
import { AIPanel } from "../AIPanel";
import { ChatPanel } from "../ChatPanel";
import { DrawingActivityPanel } from "../DrawingActivityPanel";
import { GridSettings } from "../GridSettings";
import { LayerPanel } from "../LayerPanel";
import { TimelapsePanel } from "../TimelapsePanel";
import { DrawingAgentPanel } from "../agent/DrawingAgentWorkspace";
import type { RightSectionId } from "../../core/panelLayout";
import { TextPanelSection } from "./TextPanelSection";
import type { PanelRenderContext } from "./types";
import { ViewPanelSection } from "./ViewPanelSection";

type PanelRenderer = (context: PanelRenderContext) => ReactNode;

const PANEL_RENDERERS: Record<RightSectionId, PanelRenderer> = {
  text: ({ documentState }) => (
    <TextPanelSection documentState={documentState} />
  ),
  view: ({ viewState }) => (
    <ViewPanelSection viewState={viewState} />
  ),
  grid: ({ viewState }) => (
    <GridSettings grid={viewState.grid} setGrid={viewState.setGrid} />
  ),
  activity: () => <DrawingActivityPanel />,
  aiDraw: ({ drawState }) => <DrawingAgentPanel key={drawState.documentKey} {...drawState} />,
  layers: ({ documentState }) =>
    documentState.doc && documentState.history ? (
      <LayerPanel doc={documentState.doc} history={documentState.history} />
    ) : null,
  timelapse: ({ documentState }) =>
    documentState.timelapse ? (
      <TimelapsePanel timelapse={documentState.timelapse} />
    ) : null,
  chat: ({ aiState, chatState }) => (
    <ChatPanel
      messages={chatState.chatMessages}
      isLoading={chatState.chatLoading}
      error={chatState.chatError}
      draft={chatState.chatDraft}
      setDraft={chatState.setChatDraft}
      attachCanvasNext={chatState.chatAttachCanvas}
      setAttachCanvasNext={chatState.setChatAttachCanvas}
      onSend={chatState.onChatSend}
      onClear={chatState.onChatClear}
      onApplyGuides={chatState.onApplyChatGuides}
      onClearGuides={chatState.onClearChatGuides}
      onApplyPalette={chatState.onApplyChatPalette}
      detachable
      onDetachWindow={chatState.onDetachChatWindow}
      hasApiKey={aiState.auth.hasApiKey}
    />
  ),
  ai: ({ aiState }) => (
    <AIPanel
      hasApiKey={aiState.auth.hasApiKey}
      prompt={aiState.input.aiPrompt}
      setPrompt={aiState.input.setAIPrompt}
      mode={aiState.input.aiMode}
      setMode={aiState.input.setAIMode}
      stage={aiState.input.stage}
      setStage={aiState.input.setStage}
      references={aiState.input.references}
      canAddReference={aiState.input.canAddReference}
      onAddReference={aiState.input.onAddReference}
      onRemoveReference={aiState.input.onRemoveReference}
      selection={aiState.target.selection}
      zoomTarget={aiState.target.zoomTarget}
      setZoomTarget={aiState.target.setZoomTarget}
      onAnalyze={aiState.actions.onAnalyze}
      onLocalPalette={aiState.actions.onLocalPalette}
      onCompare={aiState.actions.onCompare}
      hasPrevious={aiState.actions.hasPreviousSnapshot}
      anyChatLoading={aiState.actions.anyChatLoading}
      isLoading={aiState.output.isLoading}
      isLoadingInAnotherTab={aiState.output.isLoadingInAnotherTab}
      advice={aiState.output.advice}
      error={aiState.output.error}
      guides={aiState.output.guides}
      showGuides={aiState.output.showGuides}
      setShowGuides={aiState.output.setShowGuides}
      onClearGuides={aiState.output.onClearGuides}
      onHighlightGuide={aiState.output.onHighlightGuide}
      palette={aiState.output.palette}
      onUsePaletteColor={aiState.output.onUsePaletteColor}
    />
  ),
};

export function renderPanelSection(
  id: RightSectionId,
  context: PanelRenderContext
): ReactNode {
  return PANEL_RENDERERS[id](context);
}
