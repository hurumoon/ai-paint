import type { MutableRefObject, RefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";

export interface Point {
  x: number;
  y: number;
}

export interface CanvasToolSessionRefs {
  compositeRef: RefObject<HTMLCanvasElement | null>;
  previewRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
}

export interface CanvasToolSessionOverlayPreview {
  polygonPointsRef: MutableRefObject<Point[]>;
  polygonHoverRef: MutableRefObject<Point | null>;
  requestOverlayRedraw: () => void;
  clearPreview: () => void;
}
