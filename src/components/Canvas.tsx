import { memo, useRef } from "react";
import { useCanvasViewportControls } from "../hooks/useCanvasViewportControls";
import { useCanvasInteractionController } from "../hooks/canvasTools/useCanvasInteractionController";
import { useCanvasRendererLifecycle } from "../hooks/canvasTools/useCanvasRendererLifecycle";
import { CanvasStage } from "./canvas/CanvasStage";
import { CanvasScrollbars } from "./canvas/CanvasScrollbars";

import type { CanvasProps } from "./canvas/types";
export type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasOverlayState,
  CanvasProps,
  CanvasToolState,
  CanvasViewState,
} from "./canvas/types";

function CanvasInner({
  documentState,
  toolState,
  viewState,
  overlayState,
  documentIO,
}: CanvasProps) {
  const { doc, version } = documentState;
  const { tool, moveMode } = toolState;
  const {
    zoom,
    setZoom,
    pan,
    setPan,
    rotation,
    canvasFlipped,
    shortcuts,
    isFileLoading,
  } = viewState;
  const { canvasExtendPreview, replayFrame } = overlayState;

  const compositeRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const rendererRef = useCanvasRendererLifecycle({
    doc,
    version,
    compositeRef,
    overlayRef,
    inputRef,
    previewRef,
  });

  const {
    contentW,
    contentH,
    hBarRef,
    vBarRef,
    handleViewportPointerDown,
    handleViewportPointerMove,
    handleViewportPointerUp,
    onHScroll,
    onVScroll,
    isPanning,
    shouldStartPan,
    stageStyle,
  } = useCanvasViewportControls({
    areaRef,
    inputRef,
    canvasWidth: doc.width,
    canvasHeight: doc.height,
    zoom,
    setZoom,
    pan,
    setPan,
    rotation,
    canvasFlipped,
    tool,
    moveMode,
    shortcuts,
    isFileLoading,
  });

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
  } = useCanvasInteractionController({
    documentState,
    toolState,
    viewState,
    overlayState,
    documentIO,
    refs: {
      compositeRef,
      overlayRef,
      inputRef,
      previewRef,
      rendererRef,
    },
    viewport: {
      shouldStartPan,
      handleViewportPointerDown,
      handleViewportPointerUp,
      isPanning,
    },
  });

  return (
    <div className="canvas-area-wrap">
      <div
        className="canvas-area"
        ref={areaRef}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerLeave={handleViewportPointerUp}
        onContextMenu={(e) => {
          // パン中、または右クリックパン中はコンテキストメニュー抑止
          e.preventDefault();
        }}
      >
        <CanvasStage
          width={doc.width}
          height={doc.height}
          stageStyle={stageStyle}
          compositeRef={compositeRef}
          previewRef={previewRef}
          overlayRef={overlayRef}
          inputRef={inputRef}
          canvasExtendPreview={canvasExtendPreview}
          replayFrame={replayFrame}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
        />
      </div>
      <CanvasScrollbars
        vBarRef={vBarRef}
        hBarRef={hBarRef}
        contentW={contentW}
        contentH={contentH}
        onVScroll={onVScroll}
        onHScroll={onHScroll}
      />
    </div>
  );
}

export const Canvas = memo(CanvasInner);
