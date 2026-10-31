import { compositeLayers, type CompositeLayer } from "../composite";
import type { PaintDocument, PixelLayer } from "../PaintDocument";
import { canvasToPngBytes } from "./png";

const MAX_THUMBNAIL_EDGE = 2048;

export function computeThumbnailSize(width: number, height: number) {
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function scaledLayer(layer: PixelLayer, sx: number, sy: number): CompositeLayer {
  const source = layer.store;
  const deferred = layer.deferred;
  return {
    meta: layer.meta,
    deferred: deferred && {
      offsetX: deferred.offsetX * sx,
      offsetY: deferred.offsetY * sy,
      bboxWidth: deferred.bboxWidth * sx,
      bboxHeight: deferred.bboxHeight * sy,
    },
    store: {
      width: source.width * sx,
      height: source.height * sy,
      getAlphaBounds() {
        const bounds = source.getAlphaBounds();
        return bounds && {
          x: bounds.x * sx, y: bounds.y * sy,
          w: bounds.w * sx, h: bounds.h * sy,
        };
      },
      drawTo(ctx, dx, dy, clip) {
        ctx.save();
        try {
          ctx.translate(dx, dy);
          ctx.scale(sx, sy);
          source.drawTo(ctx, 0, 0, clip && {
            x: (clip.x - dx) / sx, y: (clip.y - dy) / sy,
            w: clip.w / sx, h: clip.h / sy,
          });
        } finally {
          ctx.restore();
        }
      },
    },
  };
}

export async function createThumbnailPng(doc: PaintDocument): Promise<Uint8Array> {
  const size = computeThumbnailSize(doc.width, doc.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    // 合成器に渡す座標も縮小し、グループ・クリップ用の中間Canvasも小さく保つ。
    // 元のTileStoreを読むだけなので、deferredの実体化や原寸PNGの生成は不要。
    const layers = doc.layers.map(layer => scaledLayer(
      layer, size.width / doc.width, size.height / doc.height,
    ));
    compositeLayers(ctx, size, layers, undefined,
      { x: 0, y: 0, w: size.width, h: size.height }, undefined, true);
    return await canvasToPngBytes(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
