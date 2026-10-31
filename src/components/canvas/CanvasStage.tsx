import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { CanvasExtendPreview } from "../../types";

interface CanvasExtendPreviewOverlayProps {
  preview: CanvasExtendPreview | null;
  width: number;
  height: number;
}

function CanvasExtendPreviewOverlay({
  preview,
  width,
  height,
}: CanvasExtendPreviewOverlayProps) {
  if (!preview) return null;
  const newWidth = width + preview.left + preview.right;
  const newHeight = height + preview.top + preview.bottom;
  const hasChanges =
    preview.top !== 0 || preview.right !== 0 || preview.bottom !== 0 || preview.left !== 0;
  if (!hasChanges || newWidth <= 0 || newHeight <= 0) return null;

  return (
    <div className="canvas-extend-preview" aria-hidden="true">
      <div
        className="canvas-extend-preview-frame"
        style={{
          left: -preview.left,
          top: -preview.top,
          width: newWidth,
          height: newHeight,
        }}
      >
        <span>適用後</span>
      </div>
      <div
        className="canvas-extend-preview-current"
        style={{ left: 0, top: 0, width, height }}
      />
    </div>
  );
}

interface CanvasStageProps {
  replayFrame?: import("../../core/agent/recording").DrawingAgentPreviewFrame;
  width: number;
  height: number;
  stageStyle: CSSProperties;
  compositeRef: RefObject<HTMLCanvasElement>;
  previewRef: RefObject<HTMLCanvasElement>;
  overlayRef: RefObject<HTMLCanvasElement>;
  inputRef: RefObject<HTMLCanvasElement>;
  canvasExtendPreview: CanvasExtendPreview | null;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLCanvasElement>) => void;
}

export function CanvasStage({
  width,
  height,
  stageStyle,
  compositeRef,
  previewRef,
  overlayRef,
  inputRef,
  canvasExtendPreview,
  replayFrame,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}: CanvasStageProps) {
  return (
    <div className="canvas-stage" style={stageStyle}>
      <canvas
        ref={compositeRef}
        className="composite-canvas"
        width={width}
        height={height}
      />
      <canvas
        ref={previewRef}
        className="overlay-canvas"
        width={width}
        height={height}
        style={{ zIndex: 15 }}
      />
      <canvas
        ref={overlayRef}
        className="overlay-canvas"
        width={width}
        height={height}
      />
      <canvas
        ref={inputRef}
        className="input-canvas"
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      {replayFrame && <img className="agent-canvas-replay" src={replayFrame.dataUrl} alt="制作過程の記録" draggable={false}
        style={{ position: "absolute", inset: 0, width, height, objectFit: "contain", background: "white", pointerEvents: "none", zIndex: 19 }} />}
      <CanvasExtendPreviewOverlay
        preview={canvasExtendPreview}
        width={width}
        height={height}
      />
    </div>
  );
}
