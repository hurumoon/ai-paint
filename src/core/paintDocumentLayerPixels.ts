import { drawStoreWithBlendMode } from "./composite";
import { TileStore } from "./TileStore";
import { renderTextToLayer } from "./textLayerRaster";
import type { LayerMeta } from "../types";
import type { DeferredLayerInfo, PixelLayer } from "./PaintDocument";

export interface ImageDataLayerInput {
  meta: LayerMeta;
  imageData: ImageData;
  deferred?: DeferredLayerInfo;
}

export interface CanvasLayerInput {
  meta: LayerMeta;
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  deferred?: DeferredLayerInfo;
}

function assignStore(layer: PixelLayer, store: TileStore): void {
  layer.store = store;
}

export function materializeDeferredLayer(
  layer: PixelLayer,
  width: number,
  height: number
): void {
  const def = layer.deferred;
  if (!def) return;
  const fresh = new TileStore(width, height);
  if (def.bboxWidth > 0 && def.bboxHeight > 0) {
    fresh.adoptFromAt(layer.store, def.offsetX, def.offsetY);
  }
  assignStore(layer, fresh);
  layer.deferred = undefined;
}

export function createLayerFromImageData(
  src: ImageDataLayerInput,
  width: number,
  height: number
): PixelLayer {
  if (src.deferred) {
    const def = src.deferred;
    const w = Math.max(1, def.bboxWidth);
    const h = Math.max(1, def.bboxHeight);
    const store = new TileStore(w, h);
    if (def.bboxWidth > 0 && def.bboxHeight > 0) {
      store.putImageData(src.imageData, 0, 0);
    }
    return {
      meta: { ...src.meta },
      store,
      deferred: { ...def },
    };
  }

  const store = new TileStore(width, height);
  store.putImageData(src.imageData, 0, 0);
  return {
    meta: { ...src.meta },
    store,
  };
}

export function createLayerFromCanvas(
  src: CanvasLayerInput,
  width: number,
  height: number
): PixelLayer {
  if (src.deferred && src.canvas && src.ctx) {
    const store = TileStore.fromCanvas(src.canvas, src.ctx);
    return {
      meta: { ...src.meta },
      store,
      deferred: { ...src.deferred },
    };
  }

  if (src.canvas && src.ctx && src.canvas.width === width && src.canvas.height === height) {
    const store = TileStore.fromCanvas(src.canvas, src.ctx);
    return {
      meta: { ...src.meta },
      store,
    };
  }

  if (src.meta.kind !== "group" && src.canvas) {
    console.warn(
      `replaceLayersFromCanvas: ピクセルを破棄します (layer="${src.meta.name}" ` +
        `canvas=${src.canvas.width}x${src.canvas.height} doc=${width}x${height})。` +
        `呼び出し側で doc.resize() を先に行うか deferred を指定してください。`
    );
  }

  const store = new TileStore(width, height);
  return {
    meta: { ...src.meta },
    store,
  };
}

export function mergeLayerPixelsDown(
  upper: PixelLayer,
  lower: PixelLayer,
  width: number,
  height: number
): void {
  const ud = upper.deferred;
  const ld = lower.deferred;

  if (ld) {
    const lBox = { x: ld.offsetX, y: ld.offsetY, w: ld.bboxWidth, h: ld.bboxHeight };
    const uBox = ud
      ? { x: ud.offsetX, y: ud.offsetY, w: ud.bboxWidth, h: ud.bboxHeight }
      : { x: 0, y: 0, w: width, h: height };

    const lEmpty = lBox.w <= 0 || lBox.h <= 0;
    const uEmpty = uBox.w <= 0 || uBox.h <= 0;
    let nx0: number;
    let ny0: number;
    let nx1: number;
    let ny1: number;
    if (lEmpty && uEmpty) {
      nx0 = 0;
      ny0 = 0;
      nx1 = 0;
      ny1 = 0;
    } else if (lEmpty) {
      nx0 = uBox.x;
      ny0 = uBox.y;
      nx1 = uBox.x + uBox.w;
      ny1 = uBox.y + uBox.h;
    } else if (uEmpty) {
      nx0 = lBox.x;
      ny0 = lBox.y;
      nx1 = lBox.x + lBox.w;
      ny1 = lBox.y + lBox.h;
    } else {
      nx0 = Math.min(lBox.x, uBox.x);
      ny0 = Math.min(lBox.y, uBox.y);
      nx1 = Math.max(lBox.x + lBox.w, uBox.x + uBox.w);
      ny1 = Math.max(lBox.y + lBox.h, uBox.y + uBox.h);
    }

    nx0 = Math.max(0, nx0);
    ny0 = Math.max(0, ny0);
    nx1 = Math.min(width, nx1);
    ny1 = Math.min(height, ny1);
    const newW = nx1 - nx0;
    const newH = ny1 - ny0;

    if (newW > 0 && newH > 0) {
      const fresh = new TileStore(newW, newH);
      if (lBox.w > 0 && lBox.h > 0) {
        fresh.adoptFromAt(lower.store, lBox.x - nx0, lBox.y - ny0);
      }
      const upperOffX = (ud ? uBox.x : 0) - nx0;
      const upperOffY = (ud ? uBox.y : 0) - ny0;
      const upperHint = {
        x: uBox.x - nx0,
        y: uBox.y - ny0,
        w: uBox.w,
        h: uBox.h,
      };
      fresh.withCtx((ctx) => {
        drawStoreWithBlendMode(
          ctx,
          upper.store,
          upperOffX,
          upperOffY,
          upper.meta.blendMode,
          upper.meta.opacity,
          upperHint,
          upperHint
        );
      }, upperHint);

      assignStore(lower, fresh);
      if (nx0 === 0 && ny0 === 0 && newW === width && newH === height) {
        lower.deferred = undefined;
      } else {
        lower.deferred = {
          offsetX: nx0,
          offsetY: ny0,
          bboxWidth: newW,
          bboxHeight: newH,
        };
      }
    }
  } else {
    const hint = ud
      ? { x: ud.offsetX, y: ud.offsetY, w: ud.bboxWidth, h: ud.bboxHeight }
      : { x: 0, y: 0, w: width, h: height };
    lower.store.withCtx((ctx) => {
      const upperX = ud ? ud.offsetX : 0;
      const upperY = ud ? ud.offsetY : 0;
      drawStoreWithBlendMode(
        ctx,
        upper.store,
        upperX,
        upperY,
        upper.meta.blendMode,
        upper.meta.opacity,
        hint,
        hint
      );
    }, hint);
  }

  lower.meta.kind = "raster";
  delete lower.meta.text;
}

export function extendLayerPixels(
  layer: PixelLayer,
  newWidth: number,
  newHeight: number,
  top: number,
  left: number
): void {
  const fresh = new TileStore(newWidth, newHeight);
  const dx = left + (layer.deferred?.offsetX ?? 0);
  const dy = top + (layer.deferred?.offsetY ?? 0);
  fresh.adoptFromAt(layer.store, dx, dy);
  assignStore(layer, fresh);
  layer.deferred = undefined;
  if (layer.meta.kind === "text" && layer.meta.text) {
    layer.meta.text = {
      ...layer.meta.text,
      x: layer.meta.text.x + left,
      y: layer.meta.text.y + top,
    };
    renderTextToLayer(layer, newWidth, newHeight, layer.meta.text);
  }
}

export function resizeLayerPixels(
  layer: PixelLayer,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number
): void {
  const def = layer.deferred;
  const fresh = new TileStore(newWidth, newHeight);
  if (def && def.bboxWidth > 0 && def.bboxHeight > 0) {
    const sx = newWidth / oldWidth;
    const sy = newHeight / oldHeight;
    fresh.adoptFromScaled(
      layer.store,
      0,
      0,
      def.bboxWidth,
      def.bboxHeight,
      def.offsetX * sx,
      def.offsetY * sy,
      def.bboxWidth * sx,
      def.bboxHeight * sy
    );
  } else if (!def) {
    fresh.adoptFromScaled(layer.store, 0, 0, oldWidth, oldHeight, 0, 0, newWidth, newHeight);
  }

  assignStore(layer, fresh);
  layer.deferred = undefined;
  if (layer.meta.kind === "text") {
    // 解像度変更は全レイヤーの現在の見た目をそのままリサンプルする。
    // 編集可能なテキストとして再描画すると縦横比変更を再現できないため、
    // リサンプル済みピクセルを正本としてラスターレイヤーへ変換する。
    layer.meta.kind = "raster";
    delete layer.meta.text;
  }
}
