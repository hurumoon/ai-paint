import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { PaintDocument } from "../../core/PaintDocument";
import {
  magicWandMask,
  polygonBBox,
} from "../../core/toolHandlers";
import { pushToast } from "../../ui/primitives";
import type { SelectKind, Selection, Tool } from "../../types";

interface Point {
  x: number;
  y: number;
}

interface UseSelectionSessionParams {
  doc: PaintDocument;
  tool: Tool;
  selectKind: SelectKind;
  setSelection: (selection: Selection) => void;
  zoom: number;
  magicTolerance: number;
  magicContiguous: boolean;
  magicSampleAllLayers: boolean;
  compositeRef: RefObject<HTMLCanvasElement | null>;
  polygonPointsRef: MutableRefObject<Point[]>;
  polygonHoverRef: MutableRefObject<Point | null>;
  requestOverlayRedraw: () => void;
}

export function useSelectionSession({
  doc,
  tool,
  selectKind,
  setSelection,
  zoom,
  magicTolerance,
  magicContiguous,
  magicSampleAllLayers,
  compositeRef,
  polygonPointsRef,
  polygonHoverRef,
  requestOverlayRedraw,
}: UseSelectionSessionParams) {
  const rectStartRef = useRef<Point | null>(null);

  const closePolygonSelection = useCallback(
    (points: Point[]) => {
      const bbox = polygonBBox(points);
      setSelection({
        kind: "polygon",
        points: points.slice(),
        x: bbox.x,
        y: bbox.y,
        w: bbox.w,
        h: bbox.h,
      });
      polygonPointsRef.current = [];
      polygonHoverRef.current = null;
    },
    [polygonHoverRef, polygonPointsRef, setSelection]
  );

  const clearPolygonProgress = useCallback((): boolean => {
    if (polygonPointsRef.current.length === 0 && !polygonHoverRef.current) {
      return false;
    }
    polygonPointsRef.current = [];
    polygonHoverRef.current = null;
    requestOverlayRedraw();
    return true;
  }, [polygonHoverRef, polygonPointsRef, requestOverlayRedraw]);

  const startSelectionSession = useCallback(
    (pos: Point, detail: number): boolean => {
      if (tool !== "select") return false;

      if (selectKind === "rect") {
        rectStartRef.current = pos;
        setSelection({ kind: "rect", x: pos.x, y: pos.y, w: 0, h: 0 });
        return true;
      }

      if (selectKind === "polygon") {
        const points = polygonPointsRef.current;
        const closeRadiusPx = 10 / Math.max(0.1, zoom);
        if (points.length >= 3) {
          const dxFirst = points[0].x - pos.x;
          const dyFirst = points[0].y - pos.y;
          if (Math.hypot(dxFirst, dyFirst) <= closeRadiusPx) {
            closePolygonSelection(points);
            return true;
          }
        }
        if (points.length >= 3 && detail >= 2) {
          closePolygonSelection(points);
          return true;
        }
        polygonPointsRef.current.push({ x: pos.x, y: pos.y });
        polygonHoverRef.current = pos;
        requestOverlayRedraw();
        return true;
      }

      if (selectKind === "magic") {
        let imageData: ImageData;
        if (magicSampleAllLayers) {
          const ctx = compositeRef.current?.getContext("2d");
          if (!ctx) return true;
          imageData = ctx.getImageData(0, 0, doc.width, doc.height);
        } else {
          const active = doc.getActiveLayer();
          if (!active) return true;
          doc.materializeLayer(active);
          imageData = active.store.getImageData(0, 0, doc.width, doc.height);
        }
        const result = magicWandMask(
          imageData,
          pos.x,
          pos.y,
          magicTolerance,
          magicContiguous
        );
        if (result) {
          setSelection({ kind: "mask", ...result });
          pushToast(
            magicContiguous ? "自動選択しました" : "色域全体を選択しました",
            "success"
          );
        } else {
          pushToast("選択できませんでした", "info");
        }
        return true;
      }

      return false;
    },
    [
      closePolygonSelection,
      compositeRef,
      doc,
      magicContiguous,
      magicSampleAllLayers,
      magicTolerance,
      polygonHoverRef,
      polygonPointsRef,
      requestOverlayRedraw,
      selectKind,
      setSelection,
      tool,
      zoom,
    ]
  );

  const updateSelectionSession = useCallback(
    (pos: Point): boolean => {
      if (tool !== "select") return false;

      if (selectKind === "polygon" && polygonPointsRef.current.length > 0) {
        polygonHoverRef.current = pos;
        requestOverlayRedraw();
        return true;
      }

      if (selectKind === "rect" && rectStartRef.current) {
        const start = rectStartRef.current;
        setSelection({
          kind: "rect",
          x: Math.min(start.x, pos.x),
          y: Math.min(start.y, pos.y),
          w: Math.abs(pos.x - start.x),
          h: Math.abs(pos.y - start.y),
        });
        return true;
      }

      return false;
    },
    [
      polygonHoverRef,
      polygonPointsRef,
      requestOverlayRedraw,
      selectKind,
      setSelection,
      tool,
    ]
  );

  const finishSelectionSession = useCallback((): boolean => {
    if (!rectStartRef.current) return false;
    rectStartRef.current = null;
    return true;
  }, []);

  const cancelSelectionSession = useCallback((): void => {
    rectStartRef.current = null;
    clearPolygonProgress();
  }, [clearPolygonProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && polygonPointsRef.current.length > 0) {
        polygonPointsRef.current = [];
        polygonHoverRef.current = null;
        requestOverlayRedraw();
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [polygonHoverRef, polygonPointsRef, requestOverlayRedraw]);

  useEffect(() => {
    if (tool !== "select" || selectKind !== "polygon") {
      clearPolygonProgress();
    }
    if (tool !== "select" || selectKind !== "rect") {
      rectStartRef.current = null;
    }
  }, [clearPolygonProgress, selectKind, tool]);

  return {
    polygonPointsRef,
    polygonHoverRef,
    startSelectionSession,
    updateSelectionSession,
    finishSelectionSession,
    cancelSelectionSession,
  };
}
