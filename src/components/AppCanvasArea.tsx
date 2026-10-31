import { lazy, useMemo } from "react";
import type { ScoreChallengeHandler } from "./aiChallenge/types";
import type {
  CanvasDocumentIO,
  CanvasOverlayState,
  CanvasViewState,
} from "./canvas/types";
import type { History } from "../core/History";
import type { PaintDocument } from "../core/PaintDocument";
import type { Timelapse } from "../core/Timelapse";
import type { CanvasToolProps } from "../hooks/useToolState";
import type { ChallengeItem } from "../types";
import { IconCanvas } from "../ui/Icons";

const Canvas = lazy(() =>
  import("./Canvas").then((module) => ({ default: module.Canvas }))
);
const SubView = lazy(() =>
  import("./SubView").then((module) => ({ default: module.SubView }))
);
const ReferenceView = lazy(() =>
  import("./ReferenceView").then((module) => ({ default: module.ReferenceView }))
);
const DrawingGuideView = lazy(() =>
  import("./DrawingGuideView").then((module) => ({ default: module.DrawingGuideView }))
);
const AIChallengeMode = lazy(() =>
  import("./AIChallengeMode").then((module) => ({ default: module.AIChallengeMode }))
);

export interface AppCanvasDocumentState {
  doc: PaintDocument | null;
  history: History | null;
  timelapse: Timelapse | null;
  version: number;
}

export interface AppCanvasModel {
  canvasDocument: AppCanvasDocumentState;
  canvasViewState: CanvasViewState;
  canvasOverlayState: CanvasOverlayState;
  canvasDocumentIO: CanvasDocumentIO;
}

export interface AppCanvasAreaProps {
  hasActiveTab: boolean;
  canvasDocument: AppCanvasDocumentState;
  canvasToolProps: CanvasToolProps;
  canvasViewState: CanvasViewState;
  canvasOverlayState: CanvasOverlayState;
  canvasDocumentIO: CanvasDocumentIO;
  showDrawingGuide: boolean;
  onCloseDrawingGuide: () => void;
  showSubview: boolean;
  onCloseSubview: () => void;
  showReference: boolean;
  onCloseReference: () => void;
  enhancedAIEnabled: boolean;
  canScoreChallenge: boolean;
  isChallengeScoring: boolean;
  onScoreChallenge: ScoreChallengeHandler;
  challengeItems: ChallengeItem[];
  onOpenNewCanvasDialog: () => void;
  onOpenImage: () => void;
}

export function AppCanvasArea({
  hasActiveTab,
  canvasDocument,
  canvasToolProps,
  canvasViewState,
  canvasOverlayState,
  canvasDocumentIO,
  showDrawingGuide,
  onCloseDrawingGuide,
  showSubview,
  onCloseSubview,
  showReference,
  onCloseReference,
  enhancedAIEnabled,
  canScoreChallenge,
  isChallengeScoring,
  onScoreChallenge,
  challengeItems,
  onOpenNewCanvasDialog,
  onOpenImage,
}: AppCanvasAreaProps) {
  const { doc, history, timelapse, version } = canvasDocument;
  const canvasDocumentState = useMemo(
    () => (doc && history && timelapse ? { doc, version, history, timelapse } : null),
    [doc, history, timelapse, version]
  );

  return (
    <div style={{ position: "relative", gridArea: "canvas", overflow: "hidden" }}>
      {hasActiveTab && canvasDocumentState ? (
        <Canvas
          documentState={canvasDocumentState}
          toolState={canvasToolProps}
          viewState={canvasViewState}
          overlayState={canvasOverlayState}
          documentIO={canvasDocumentIO}
        />
      ) : (
        <div className="empty-canvas-placeholder">
          <div className="empty-canvas-box">
            <IconCanvas />
            <div className="empty-canvas-title">キャンバスがありません</div>
            <div className="empty-canvas-sub">
              新規キャンバスを作成するか、ファイルを開いてください。
            </div>
            <div className="empty-canvas-actions">
              <button className="btn primary" onClick={onOpenNewCanvasDialog}>
                新規キャンバス
              </button>
              <button className="btn" onClick={onOpenImage}>
                ファイルを開く
              </button>
            </div>
          </div>
        </div>
      )}
      {(showDrawingGuide || (hasActiveTab && doc && (showSubview || showReference))) && (
        <div className="subview-stack">
          {hasActiveTab && doc && showSubview && (
            <SubView doc={doc} version={version} onClose={onCloseSubview} />
          )}
          {hasActiveTab && doc && showReference && (
            <ReferenceView onClose={onCloseReference} />
          )}
          {showDrawingGuide && (
            <DrawingGuideView onClose={onCloseDrawingGuide} />
          )}
        </div>
      )}
      {enhancedAIEnabled && hasActiveTab && doc && (
        <AIChallengeMode
          canScore={canScoreChallenge}
          isScoring={isChallengeScoring}
          onScoreChallenge={onScoreChallenge}
          challengeItems={challengeItems}
        />
      )}
    </div>
  );
}
