import { useCallback } from "react";
import type { RefObject } from "react";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { Timelapse } from "../../core/Timelapse";
import {
  countChangedPixels,
  estimateRectDrawingAmount,
  recordDrawingActivity,
} from "../../core/drawingActivity";
import {
  hexToRgba,
  selectionBBox,
  selectionMaskCanvas,
} from "../../core/toolHandlers";
import { applyTransparentPixelLock } from "../../core/transparentPixelLock";
import { pushToast } from "../../ui/primitives";
import type { Selection } from "../../types";
import { floodFillWorker } from "../../workers/paintWorkerClient";

interface Point {
  x: number;
  y: number;
}

interface UseBucketFillSessionParams {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
  color: string;
  bucketTolerance: number;
  bucketGapClose: number;
  bucketExpand: number;
  compositeRef: RefObject<HTMLCanvasElement | null>;
  isAutoBackupBusy?: () => boolean;
}

export function useBucketFillSession({
  doc,
  history,
  timelapse,
  selection,
  color,
  bucketTolerance,
  bucketGapClose,
  bucketExpand,
  compositeRef,
  isAutoBackupBusy,
}: UseBucketFillSessionParams) {
  const fillBucketAt = useCallback(
    async (pos: Point): Promise<boolean> => {
      const layer = doc.getActiveLayer();
      if (!layer || layer.meta.locked || layer.meta.kind === "group") {
        return true;
      }
      if (isAutoBackupBusy?.()) {
        pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
        return true;
      }
      if (selection.kind !== "none" && !isPointInSelection(pos.x, pos.y, selection)) {
        pushToast("選択範囲の外です", "info");
        return true;
      }

      try {
        history.beginOperation(doc, [layer.meta.id]);
        const imageData = layer.store.getImageData(0, 0, doc.width, doc.height);
        let refImageData: ImageData | undefined;
        if (bucketGapClose > 0) {
          const cctx = compositeRef.current?.getContext("2d");
          if (cctx) {
            refImageData = cctx.getImageData(0, 0, doc.width, doc.height);
          }
        }
        const filled = await floodFillWorker(
          imageData,
          pos.x,
          pos.y,
          hexToRgba(color),
          bucketTolerance,
          {
            gapClose: bucketGapClose,
            expand: bucketExpand,
            refImageData,
          }
        );
        if (layer.meta.transparentPixelLock) {
          applyTransparentPixelLock(imageData, filled);
        }
        const activityAmount =
          selection.kind === "none"
            ? countChangedPixels(imageData, filled)
            : estimateRectDrawingAmount(
                selectionBBox(selection, doc.width, doc.height),
                doc.width,
                doc.height
              );
        if (selection.kind === "none") {
          layer.store.putImageData(filled, 0, 0);
        } else {
          const tmp = document.createElement("canvas");
          tmp.width = doc.width;
          tmp.height = doc.height;
          const tctx = tmp.getContext("2d");
          if (!tctx) {
            history.cancelOperation();
            return true;
          }
          tctx.putImageData(filled, 0, 0);
          const maskCanvas = selectionMaskCanvas(selection, doc.width, doc.height);
          if (maskCanvas) {
            tctx.globalCompositeOperation = "destination-in";
            tctx.drawImage(maskCanvas, 0, 0);
            tctx.globalCompositeOperation = "source-over";
          }
          const bucketHint = selectionBBox(selection, doc.width, doc.height);
          layer.store.withCtx((ctx) => {
            const lctx = ctx as CanvasRenderingContext2D;
            if (maskCanvas) {
              lctx.save();
              lctx.globalCompositeOperation = "destination-out";
              lctx.drawImage(maskCanvas, 0, 0);
              lctx.restore();
            }
            lctx.drawImage(tmp, 0, 0);
          }, bucketHint);
        }
        doc.invalidateActive();
        history.commitOperation(doc, "塗りつぶし", [layer.meta.id]);
        recordDrawingActivity(activityAmount);
        await timelapse.captureIfEnabled(doc);
      } catch (err) {
        history.cancelOperation();
        pushToast(`バケツ失敗: ${err}`, "error");
      }
      return true;
    },
    [
      bucketExpand,
      bucketGapClose,
      bucketTolerance,
      color,
      compositeRef,
      doc,
      history,
      isAutoBackupBusy,
      selection,
      timelapse,
    ]
  );

  return { fillBucketAt };
}

function isPointInSelection(x: number, y: number, selection: Selection): boolean {
  if (selection.kind === "none") return true;
  if (selection.kind === "rect") {
    return (
      x >= selection.x &&
      x < selection.x + selection.w &&
      y >= selection.y &&
      y < selection.y + selection.h
    );
  }
  if (selection.kind === "polygon") {
    const pts = selection.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      const intersect =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  if (selection.kind === "mask") {
    const mx = Math.floor(x);
    const my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= selection.maskWidth || my >= selection.maskHeight) {
      return false;
    }
    const idx = (my * selection.maskWidth + mx) * 4;
    return selection.data[idx + 3] >= 128;
  }
  return true;
}
