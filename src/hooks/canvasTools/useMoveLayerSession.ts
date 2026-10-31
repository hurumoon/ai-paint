import { useCallback, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import {
  computeSelectionTransform,
  transformPoint,
  transformedRectBounds,
  translateSelection,
  type Rect,
  type SelectionTransform,
  type SelectionTransformMode,
} from "../../core/selectionTransform";
import type { Timelapse } from "../../core/Timelapse";
import { selectionBBox } from "../../core/toolHandlers";
import { pushToast } from "../../ui/primitives";
import type { MoveMode, Selection } from "../../types";

interface Point {
  x: number;
  y: number;
}

interface MoveSessionState {
  target: "layer" | "selection";
  transformMode: SelectionTransformMode;
  layerId: string;
  startX: number;
  startY: number;
  floating: HTMLCanvasElement;
  selectionAtStart: Selection;
  boxAtStart: Rect;
  transform: SelectionTransform;
}

interface UseMoveLayerSessionParams {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  previewRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  isDrawingRef: MutableRefObject<boolean>;
  clearPreview: () => void;
  isAutoBackupBusy?: () => boolean;
}

export function useMoveLayerSession({
  doc,
  history,
  timelapse,
  selection,
  setSelection,
  previewRef,
  rendererRef,
  isDrawingRef,
  clearPreview,
  isAutoBackupBusy,
}: UseMoveLayerSessionParams) {
  const moveStateRef = useRef<MoveSessionState | null>(null);

  const startMoveLayerSession = useCallback(
    (pos: Point, moveMode: MoveMode): boolean => {
      const transformMode = moveModeToTransformMode(moveMode);
      if (!transformMode) return false;

      const layer = doc.getActiveLayer();
      if (!layer || layer.meta.locked || layer.meta.kind === "group") {
        pushToast("ロック / グループレイヤーは移動できません", "info");
        return true;
      }
      if (layer.meta.kind === "text") {
        pushToast("テキストレイヤーの移動は未対応です", "info");
        return true;
      }
      if (isAutoBackupBusy?.()) {
        pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
        return true;
      }
      if (transformMode !== "move" && selection.kind === "none") {
        pushToast("変形する選択範囲がありません", "info");
        return true;
      }

      doc.materializeLayer(layer);

      const target: "layer" | "selection" =
        selection.kind === "none" ? "layer" : "selection";
      const rawBoxAtStart =
        target === "selection"
          ? selectionBBox(selection, doc.width, doc.height)
          : layer.store.getAlphaBounds();
      const boxAtStart = clampRectToDocStrict(
        rawBoxAtStart,
        doc.width,
        doc.height
      );

      if (!boxAtStart) {
        pushToast("変形する範囲が空です", "info");
        return true;
      }

      history.beginOperation(doc, [layer.meta.id], {
        trackRegion: true,
        initialRegion: boxAtStart,
      });
      isDrawingRef.current = true;

      const floating = createFloatingCanvas(boxAtStart);
      const fctx = floating.getContext("2d");
      if (!fctx) {
        isDrawingRef.current = false;
        history.cancelOperation();
        return true;
      }
      const localClip = { x: 0, y: 0, w: floating.width, h: floating.height };

      if (target === "layer") {
        layer.store.drawTo(fctx, -boxAtStart.x, -boxAtStart.y, localClip);
        layer.store.clearRect(
          boxAtStart.x,
          boxAtStart.y,
          boxAtStart.w,
          boxAtStart.h
        );
      } else {
        layer.store.drawTo(fctx, -boxAtStart.x, -boxAtStart.y, localClip);
        const maskCanvas = createSelectionMaskForBox(
          selection,
          boxAtStart,
          doc.width,
          doc.height
        );
        if (maskCanvas) {
          fctx.save();
          fctx.globalCompositeOperation = "destination-in";
          fctx.drawImage(maskCanvas, 0, 0);
          fctx.restore();
          layer.store.withCtx((ctx) => {
            const lctx = ctx as CanvasRenderingContext2D;
            lctx.save();
            lctx.globalCompositeOperation = "destination-out";
            lctx.drawImage(maskCanvas, boxAtStart.x, boxAtStart.y);
            lctx.restore();
          }, boxAtStart);
        }
      }

      const transform = computeSelectionTransform(transformMode, boxAtStart, pos, pos);
      moveStateRef.current = {
        target,
        transformMode,
        layerId: layer.meta.id,
        startX: pos.x,
        startY: pos.y,
        floating,
        selectionAtStart: selection,
        boxAtStart,
        transform,
      };

      drawTransformPreview(previewRef.current, doc.width, doc.height, floating, transform, boxAtStart);
      doc.invalidateActive();
      rendererRef.current?.invalidate();
      return true;
    },
    [doc, history, isAutoBackupBusy, isDrawingRef, previewRef, rendererRef, selection]
  );

  const updateMoveLayerSession = useCallback(
    (pos: Point): boolean => {
      const state = moveStateRef.current;
      if (!state) return false;
      state.transform = computeSelectionTransform(
        state.transformMode,
        state.boxAtStart,
        { x: state.startX, y: state.startY },
        pos
      );
      drawTransformPreview(
        previewRef.current,
        doc.width,
        doc.height,
        state.floating,
        state.transform,
        state.boxAtStart
      );
      rendererRef.current?.invalidate();
      return true;
    },
    [doc.height, doc.width, previewRef, rendererRef]
  );

  const finishMoveLayerSession = useCallback(async (): Promise<boolean> => {
    const state = moveStateRef.current;
    if (!state) return false;
    moveStateRef.current = null;
    isDrawingRef.current = false;

    const layer = doc.getLayer(state.layerId);
    if (!layer) {
      history.cancelOperation();
      clearPreview();
      return true;
    }

    const commitTransform =
      state.transformMode === "move"
        ? {
            ...state.transform,
            translateX: Math.round(state.transform.translateX),
            translateY: Math.round(state.transform.translateY),
          }
        : state.transform;

    // 選択範囲は開始時点で元レイヤーから切り出している。変形が実質的に
    // 恒等なら再合成せず、履歴が保持する元タイルをそのまま戻す。
    // これによりアンチエイリアス付き mask の destination-out/source-over
    // 往復による縁の劣化と、内容の変わらない履歴エントリを避ける。
    if (isIdentityTransform(commitTransform)) {
      history.rollbackOperation(doc);
      rendererRef.current?.invalidate();
      clearPreview();
      return true;
    }

    const drawHint = clampRectToDocPadded(
      transformedRectBounds(state.boxAtStart, commitTransform),
      doc.width,
      doc.height
    );
    if (drawHint) {
      history.expandRegion(drawHint);
      layer.store.withCtx((ctx) => {
        drawTransformedCanvas(
          ctx as CanvasRenderingContext2D,
          state.floating,
          commitTransform,
          state.boxAtStart
        );
      }, drawHint);
    }

    if (state.target === "selection") {
      const moved =
        state.transformMode === "move"
          ? translateSelection(
              state.selectionAtStart,
              commitTransform.translateX,
              commitTransform.translateY
            )
          : transformSelectionToMask(
              state.selectionAtStart,
              commitTransform,
              state.boxAtStart,
              doc.width,
              doc.height
            );
      setSelection(moved);
    }

    doc.invalidateActive();
    history.commitOperation(doc, operationLabel(state), [state.layerId]);
    await timelapse.captureIfEnabled(doc);
    clearPreview();
    return true;
  }, [clearPreview, doc, history, isDrawingRef, rendererRef, setSelection, timelapse]);

  const cancelMoveLayerSession = useCallback((): boolean => {
    const state = moveStateRef.current;
    if (!state) return false;
    moveStateRef.current = null;
    isDrawingRef.current = false;
    history.rollbackOperation(doc);
    rendererRef.current?.invalidate();
    clearPreview();
    return true;
  }, [clearPreview, doc, history, isDrawingRef, rendererRef]);

  return {
    startMoveLayerSession,
    updateMoveLayerSession,
    finishMoveLayerSession,
    cancelMoveLayerSession,
  };
}

function moveModeToTransformMode(moveMode: MoveMode): SelectionTransformMode | null {
  if (moveMode === "layer") return "move";
  if (moveMode === "scale") return "scale";
  if (moveMode === "rotate") return "rotate";
  if (moveMode === "free") return "free";
  return null;
}

function operationLabel(state: MoveSessionState): string {
  if (state.target === "layer") return "レイヤー移動";
  if (state.transformMode === "move") return "選択範囲を移動";
  if (state.transformMode === "scale") return "選択範囲を拡大縮小";
  if (state.transformMode === "rotate") return "選択範囲を回転";
  return "選択範囲を自由変形";
}

function isIdentityTransform(transform: SelectionTransform): boolean {
  return (
    transform.translateX === 0 &&
    transform.translateY === 0 &&
    transform.scaleX === 1 &&
    transform.scaleY === 1 &&
    transform.rotation === 0
  );
}

function drawTransformPreview(
  preview: HTMLCanvasElement | null,
  width: number,
  height: number,
  floating: HTMLCanvasElement,
  transform: SelectionTransform,
  sourceBox: Rect
): void {
  if (!preview) return;
  const ctx = preview.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  drawTransformedCanvas(ctx, floating, transform, sourceBox);
  drawTransformFrame(ctx, sourceBox, transform);
}

function drawTransformedCanvas(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  transform: SelectionTransform,
  sourceBox: Rect
): void {
  ctx.save();
  ctx.translate(
    transform.centerX + transform.translateX,
    transform.centerY + transform.translateY
  );
  ctx.rotate(transform.rotation);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.translate(-transform.centerX, -transform.centerY);
  ctx.drawImage(source, sourceBox.x, sourceBox.y);
  ctx.restore();
}

function drawTransformFrame(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  transform: SelectionTransform
): void {
  const corners = [
    transformPoint({ x: box.x, y: box.y }, transform),
    transformPoint({ x: box.x + box.w, y: box.y }, transform),
    transformPoint({ x: box.x + box.w, y: box.y + box.h }, transform),
    transformPoint({ x: box.x, y: box.y + box.h }, transform),
  ];
  ctx.save();
  ctx.strokeStyle = "#7c8cff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function transformSelectionToMask(
  selection: Selection,
  transform: SelectionTransform,
  sourceBox: Rect,
  docWidth: number,
  docHeight: number
): Selection {
  const sourceMask = createSelectionMaskForBox(
    selection,
    sourceBox,
    docWidth,
    docHeight
  );
  if (!sourceMask) return { kind: "none" };
  const outputBox = clampRectToDocPadded(
    transformedRectBounds(sourceBox, transform),
    docWidth,
    docHeight
  );
  if (!outputBox) return { kind: "none" };
  const canvas = document.createElement("canvas");
  canvas.width = outputBox.w;
  canvas.height = outputBox.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { kind: "none" };
  ctx.save();
  ctx.translate(-outputBox.x, -outputBox.y);
  drawTransformedCanvas(ctx, sourceMask, transform, sourceBox);
  ctx.restore();
  const image = ctx.getImageData(0, 0, outputBox.w, outputBox.h);
  const bbox = maskBounds(image.data, outputBox.w, outputBox.h);
  if (!bbox) return { kind: "none" };
  const cropped = ctx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
  return {
    kind: "mask",
    data: new Uint8ClampedArray(cropped.data),
    maskWidth: bbox.w,
    maskHeight: bbox.h,
    x: outputBox.x + bbox.x,
    y: outputBox.y + bbox.y,
    w: bbox.w,
    h: bbox.h,
  };
}

function maskBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 128) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function createFloatingCanvas(box: Rect): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(box.w));
  canvas.height = Math.max(1, Math.ceil(box.h));
  return canvas;
}

function createSelectionMaskForBox(
  selection: Selection,
  box: Rect,
  docWidth: number,
  docHeight: number
): HTMLCanvasElement | null {
  if (selection.kind === "none") return null;
  const mask = createFloatingCanvas(box);
  const ctx = mask.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";

  if (selection.kind === "rect") {
    if (selection.w <= 0 || selection.h <= 0) return null;
    ctx.fillRect(
      selection.x - box.x,
      selection.y - box.y,
      selection.w,
      selection.h
    );
    return mask;
  }

  if (selection.kind === "polygon") {
    if (selection.points.length < 3) return null;
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x - box.x, selection.points[0].y - box.y);
    for (let i = 1; i < selection.points.length; i += 1) {
      ctx.lineTo(selection.points[i].x - box.x, selection.points[i].y - box.y);
    }
    ctx.closePath();
    ctx.fill();
    return mask;
  }

  const img = new ImageData(
    new Uint8ClampedArray(selection.data),
    selection.maskWidth,
    selection.maskHeight
  );
  const tmp = document.createElement("canvas");
  tmp.width = selection.maskWidth;
  tmp.height = selection.maskHeight;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  const offsetX = selection.maskWidth === docWidth ? 0 : selection.x;
  const offsetY = selection.maskHeight === docHeight ? 0 : selection.y;
  ctx.drawImage(tmp, offsetX - box.x, offsetY - box.y);
  return mask;
}

function clampRectToDocStrict(
  rect: Rect | null | undefined,
  width: number,
  height: number
): Rect | null {
  if (!rect) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y2 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2) ||
    x2 <= x ||
    y2 <= y
  ) {
    return null;
  }
  return { x, y, w: x2 - x, h: y2 - y };
}

function clampRectToDocPadded(
  rect: Rect,
  width: number,
  height: number
): Rect | null {
  return clampRectToDocStrict(
    {
      x: rect.x - 2,
      y: rect.y - 2,
      w: rect.w + 4,
      h: rect.h + 4,
    },
    width,
    height
  );
}
