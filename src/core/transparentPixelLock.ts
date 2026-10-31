import { TileStore } from "./TileStore";

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function applyTransparentPixelLock(
  before: ImageData,
  after: ImageData
): void {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("透明ピクセルロックの適用範囲が一致していません");
  }

  const beforeData = before.data;
  const afterData = after.data;
  for (let i = 0; i < afterData.length; i += 4) {
    const beforeAlpha = beforeData[i + 3];
    if (beforeAlpha === 0) {
      afterData[i] = beforeData[i];
      afterData[i + 1] = beforeData[i + 1];
      afterData[i + 2] = beforeData[i + 2];
      afterData[i + 3] = 0;
      continue;
    }

    if (afterData[i + 3] === 0) {
      afterData[i] = beforeData[i];
      afterData[i + 1] = beforeData[i + 1];
      afterData[i + 2] = beforeData[i + 2];
    }
    afterData[i + 3] = beforeAlpha;
  }
}

export function applyTransparentPixelLockToStore(
  store: TileStore,
  beforeCtx: CanvasRenderingContext2D,
  rect: PixelRect,
  docWidth: number,
  docHeight: number
): PixelRect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(docWidth, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(docHeight, Math.ceil(rect.y + rect.h));
  if (x0 >= x1 || y0 >= y1) return null;

  const w = x1 - x0;
  const h = y1 - y0;
  const before = beforeCtx.getImageData(x0, y0, w, h);
  const after = store.getImageData(x0, y0, w, h);
  applyTransparentPixelLock(before, after);
  store.putImageData(after, x0, y0);
  return { x: x0, y: y0, w, h };
}
