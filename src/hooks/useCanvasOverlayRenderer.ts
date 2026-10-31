import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { GridConfig } from "../components/GridSettings";
import type { AIGuideDisplayMode, GuideShape, Selection, Tool } from "../types";

interface Point {
  x: number;
  y: number;
}

interface UseCanvasOverlayRendererParams {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  guides: GuideShape[];
  showGuides: boolean;
  aiGuideDisplayMode: AIGuideDisplayMode;
  highlightGuide: GuideShape | null;
  selection: Selection;
  grid: GridConfig;
  polygonPointsRef: MutableRefObject<Point[]>;
  polygonHoverRef: MutableRefObject<Point | null>;
  cursorPosRef: MutableRefObject<Point | null>;
  isDrawingRef: MutableRefObject<boolean>;
  tool: Tool;
  brushSize: number;
}

export function useCanvasOverlayRenderer({
  overlayRef,
  width,
  height,
  guides,
  showGuides,
  aiGuideDisplayMode,
  highlightGuide,
  selection,
  grid,
  polygonPointsRef,
  polygonHoverRef,
  cursorPosRef,
  isDrawingRef,
  tool,
  brushSize,
}: UseCanvasOverlayRendererParams): () => void {
  const requestOverlayRedrawRef = useRef<(() => void) | null>(null);

  const guideCenter = useCallback((g: GuideShape): Point => {
    if (g.type === "line") {
      return { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 };
    }
    if (g.type === "circle") {
      return { x: g.cx, y: g.cy };
    }
    return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  }, []);

  const drawGuidePin = useCallback(
    (ctx: CanvasRenderingContext2D, g: GuideShape, highlighted: boolean) => {
      const p = guideCenter(g);
      const ringR = highlighted ? 34 : 26;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = g.color;
      ctx.globalAlpha = highlighted ? 0.9 : 0.45;
      ctx.lineWidth = highlighted ? 3 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 7);
      ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();

      if (g.label) {
        ctx.font = "bold 14px sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
        ctx.fillStyle = g.color;
        const lx = p.x + 10;
        const ly = p.y - 10;
        ctx.strokeText(g.label, lx, ly);
        ctx.fillText(g.label, lx, ly);
      }
      ctx.restore();
    },
    [guideCenter]
  );

  const drawPolygonInProgress = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (polygonPointsRef.current.length === 0) return;
      ctx.save();
      ctx.strokeStyle = "#7c8cff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const pts = polygonPointsRef.current;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (polygonHoverRef.current) {
        ctx.lineTo(polygonHoverRef.current.x, polygonHoverRef.current.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#7c8cff";
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    [polygonHoverRef, polygonPointsRef]
  );

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const needsAnimation = (): boolean => {
      if (
        selection.kind === "rect" ||
        selection.kind === "polygon" ||
        selection.kind === "mask"
      ) {
        return true;
      }
      if (highlightGuide && highlightGuide.type === "rect") return true;
      return false;
    };

    const renderOverlay = () => {
      raf = 0;
      ctx.clearRect(0, 0, width, height);

      if (grid.show && grid.spacing > 1) {
        ctx.save();
        ctx.strokeStyle = grid.color;
        ctx.globalAlpha = 0.35;
        const sp = grid.spacing;
        const subSp = grid.divisions > 0 ? sp / grid.divisions : 0;
        if (subSp > 1) {
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          for (let x = subSp; x < width; x += subSp) {
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
          }
          for (let y = subSp; y < height; y += subSp) {
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(width, y + 0.5);
          }
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (let x = sp; x < width; x += sp) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, height);
        }
        for (let y = sp; y < height; y += sp) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(width, y + 0.5);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (showGuides) {
        if (aiGuideDisplayMode === "pins") {
          for (const g of guides) {
            drawGuidePin(ctx, g, highlightGuide === g);
          }
        } else {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.font = "bold 14px sans-serif";
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (const g of guides) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
          ctx.lineWidth = 5;
          if (g.type === "line") {
            ctx.beginPath();
            ctx.moveTo(g.x1, g.y1);
            ctx.lineTo(g.x2, g.y2);
            ctx.stroke();
          } else if (g.type === "circle") {
            ctx.beginPath();
            ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
            ctx.stroke();
          } else if (g.type === "rect") {
            ctx.strokeRect(g.x, g.y, g.w, g.h);
          }

          ctx.globalAlpha = 1;
          ctx.strokeStyle = g.color;
          ctx.fillStyle = g.color;
          ctx.lineWidth = 2.5;
          if (g.type === "line") {
            ctx.beginPath();
            ctx.moveTo(g.x1, g.y1);
            ctx.lineTo(g.x2, g.y2);
            ctx.stroke();
          } else if (g.type === "circle") {
            ctx.beginPath();
            ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
            ctx.stroke();
          } else if (g.type === "rect") {
            ctx.strokeRect(g.x, g.y, g.w, g.h);
          }

          if (g.label) {
            ctx.save();
            ctx.setLineDash([]);
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
            ctx.fillStyle = g.color;
            let lx = 0;
            let ly = 0;
            if (g.type === "line") {
              lx = g.x1 + 6;
              ly = g.y1 - 6;
            } else if (g.type === "circle") {
              lx = g.cx - g.r;
              ly = g.cy - g.r - 4;
            } else {
              lx = g.x + 4;
              ly = g.y - 4;
            }
            ctx.strokeText(g.label, lx, ly);
            ctx.fillText(g.label, lx, ly);
            ctx.restore();
          }
        }
        ctx.restore();
        }
      }

      if (highlightGuide && aiGuideDisplayMode === "pins") {
        drawGuidePin(ctx, highlightGuide, true);
      } else if (highlightGuide && highlightGuide.type === "rect") {
        ctx.save();
        ctx.strokeStyle = "#ff4d6d";
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -((Date.now() / 200) % 12);
        ctx.globalAlpha = 0.9;
        ctx.strokeRect(highlightGuide.x, highlightGuide.y, highlightGuide.w, highlightGuide.h);
        ctx.fillStyle = "rgba(255, 77, 109, 0.12)";
        ctx.fillRect(highlightGuide.x, highlightGuide.y, highlightGuide.w, highlightGuide.h);
        ctx.restore();
      }

      if (selection.kind === "rect" && selection.w > 0 && selection.h > 0) {
        ctx.save();
        ctx.strokeStyle = "#7c8cff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -((Date.now() / 100) % 8);
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
        ctx.restore();
      }
      if (selection.kind === "polygon" && selection.points.length >= 3) {
        ctx.save();
        ctx.strokeStyle = "#7c8cff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -((Date.now() / 100) % 8);
        ctx.beginPath();
        ctx.moveTo(selection.points[0].x, selection.points[0].y);
        for (let i = 1; i < selection.points.length; i += 1) {
          ctx.lineTo(selection.points[i].x, selection.points[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
      if (selection.kind === "mask") {
        ctx.save();
        ctx.strokeStyle = "#7c8cff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -((Date.now() / 100) % 8);
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
        ctx.restore();
      }

      drawPolygonInProgress(ctx);

      const hover = cursorPosRef.current;
      if (hover && toolShowsBrushHover(tool) && !isDrawingRef.current) {
        const r = Math.max(0.5, brushSize / 2);
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (needsAnimation()) {
        raf = requestAnimationFrame(renderOverlay);
      }
    };

    raf = requestAnimationFrame(renderOverlay);
    requestOverlayRedrawRef.current = () => {
      if (raf === 0) raf = requestAnimationFrame(renderOverlay);
    };

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      requestOverlayRedrawRef.current = null;
    };
  }, [
    brushSize,
    cursorPosRef,
    aiGuideDisplayMode,
    drawGuidePin,
    drawPolygonInProgress,
    grid,
    guides,
    height,
    highlightGuide,
    isDrawingRef,
    overlayRef,
    selection,
    showGuides,
    tool,
    width,
  ]);

  return useCallback(() => {
    requestOverlayRedrawRef.current?.();
  }, []);
}

export function toolShowsBrushHover(tool: Tool): boolean {
  return tool === "brush" || tool === "eraser";
}
