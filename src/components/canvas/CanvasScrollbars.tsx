import type { RefObject, UIEvent } from "react";

interface CanvasScrollbarsProps {
  vBarRef: RefObject<HTMLDivElement>;
  hBarRef: RefObject<HTMLDivElement>;
  contentW: number;
  contentH: number;
  onVScroll: (event: UIEvent<HTMLDivElement>) => void;
  onHScroll: (event: UIEvent<HTMLDivElement>) => void;
}

export function CanvasScrollbars({
  vBarRef,
  hBarRef,
  contentW,
  contentH,
  onVScroll,
  onHScroll,
}: CanvasScrollbarsProps) {
  return (
    <>
      <div className="canvas-vscroll" ref={vBarRef} onScroll={onVScroll}>
        <div style={{ width: 1, height: contentH }} />
      </div>
      <div className="canvas-hscroll" ref={hBarRef} onScroll={onHScroll}>
        <div style={{ width: contentW, height: 1 }} />
      </div>
      <div className="canvas-corner" />
    </>
  );
}
