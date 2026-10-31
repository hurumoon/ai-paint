import {
  AIAnalysisActions,
  AIGuideControls,
  AIModeStageControls,
  AIPaletteResult,
  AIReferenceImages,
  AIResultMessages,
} from "./ai/AIPanelControls";
import { AIPanelProps } from "./ai/types";

export type { ReferenceImage } from "./ai/types";

export function AIPanel(props: AIPanelProps) {
  return (
    <div className="section ai-panel">
      <div className="section-title">
        <span>AI アシスタント</span>
      </div>

      <AIModeStageControls
        mode={props.mode}
        setMode={props.setMode}
        stage={props.stage}
        setStage={props.setStage}
      />

      <textarea
        className="textarea"
        placeholder="質問や着目してほしい点（空欄ならモードのデフォルト）"
        value={props.prompt}
        onChange={(e) => props.setPrompt(e.target.value)}
      />

      <AIReferenceImages
        references={props.references}
        canAddReference={props.canAddReference}
        onAddReference={props.onAddReference}
        onRemoveReference={props.onRemoveReference}
      />

      <AIAnalysisActions
        selection={props.selection}
        zoomTarget={props.zoomTarget}
        setZoomTarget={props.setZoomTarget}
        onAnalyze={props.onAnalyze}
        onLocalPalette={props.onLocalPalette}
        onCompare={props.onCompare}
        hasPrevious={props.hasPrevious}
        anyChatLoading={props.anyChatLoading}
        isLoading={props.isLoading}
        isLoadingInAnotherTab={props.isLoadingInAnotherTab}
        hasApiKey={props.hasApiKey}
      />

      <AIGuideControls
        guides={props.guides}
        showGuides={props.showGuides}
        setShowGuides={props.setShowGuides}
        onClearGuides={props.onClearGuides}
        onHighlightGuide={props.onHighlightGuide}
      />

      <AIPaletteResult
        palette={props.palette}
        onUsePaletteColor={props.onUsePaletteColor}
      />

      <AIResultMessages error={props.error} advice={props.advice} />
    </div>
  );
}
