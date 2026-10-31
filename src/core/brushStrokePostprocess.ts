import type { Selection } from "../types";
import type { History, SnapshotRegion } from "./History";
import type { TileStore } from "./TileStore";
import { TILE_SIZE } from "./tileStoreGeometry";
import { applyTransparentPixelLock } from "./transparentPixelLock";

function intersect(a: SnapshotRegion, b: SnapshotRegion): SnapshotRegion | null {
  const x = Math.max(a.x, Math.floor(b.x));
  const y = Math.max(a.y, Math.floor(b.y));
  const x1 = Math.min(a.x + a.w, Math.ceil(b.x + b.w));
  const y1 = Math.min(a.y + a.h, Math.ceil(b.y + b.h));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

function cropPixels(source: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const result = new ImageData(w, h);
  for (let row = 0; row < h; row += 1) {
    const start = ((y + row) * source.width + x) * 4;
    result.data.set(source.data.subarray(start, start + w * 4), row * w * 4);
  }
  return result;
}

export function applyStrokeTransparentLock(
  store: TileStore,
  history: History,
  layerId: string,
  rect: SnapshotRegion
): void {
  history.forEachPendingBeforeTile(layerId, rect, (before, tile) => {
    const region = intersect(tile, rect);
    if (!region) return;
    const original = cropPixels(before, region.x - tile.x, region.y - tile.y, region.w, region.h);
    const after = store.getImageData(region.x, region.y, region.w, region.h);
    applyTransparentPixelLock(original, after);
    store.putImageData(after, region.x, region.y);
  });
}

function canvasFor(rect: SnapshotRegion): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = rect.w;
  canvas.height = rect.h;
  return canvas;
}

function drawSelectionMask(
  ctx: CanvasRenderingContext2D,
  selection: Selection,
  tile: SnapshotRegion,
  docWidth: number,
  docHeight: number
): void {
  if (selection.kind === "polygon") {
    let x0 = docWidth, y0 = docHeight, x1 = 0, y1 = 0;
    for (const point of selection.points) {
      x0 = Math.min(x0, Math.floor(point.x));
      y0 = Math.min(y0, Math.floor(point.y));
      x1 = Math.max(x1, Math.ceil(point.x));
      y1 = Math.max(y1, Math.ceil(point.y));
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(docWidth, x1); y1 = Math.min(docHeight, y1);
    // 小さい polygon は輪郭全体をラスタライズして旧マスクの AA を保つ。
    // 大きい場合は周囲1タイル付きで上限を設ける。Canvas のクリップ位置に
    // 依存する輪郭の丸め差はあり得るが、文書サイズの backing は確保しない。
    if (x1 - x0 > TILE_SIZE * 4 || y1 - y0 > TILE_SIZE * 4) {
      x0 = Math.max(x0, tile.x - TILE_SIZE);
      y0 = Math.max(y0, tile.y - TILE_SIZE);
      x1 = Math.min(x1, tile.x + tile.w + TILE_SIZE);
      y1 = Math.min(y1, tile.y + tile.h + TILE_SIZE);
    }
    if (x1 <= x0 || y1 <= y0) return;
    const source = canvasFor({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    try {
      const pctx = source.getContext("2d")!;
      pctx.beginPath();
      pctx.moveTo(selection.points[0].x - x0, selection.points[0].y - y0);
      for (let i = 1; i < selection.points.length; i += 1) {
        pctx.lineTo(selection.points[i].x - x0, selection.points[i].y - y0);
      }
      pctx.closePath();
      pctx.fill();
      ctx.drawImage(source, x0 - tile.x, y0 - tile.y);
    } finally {
      source.width = source.height = 0;
    }
  } else if (selection.kind === "mask") {
    // mask は文書全体形式と bbox ローカル形式の両方がある。小数オフセット時の
    // drawImage 補間も保持するため、必要な元ピクセルを周囲1px込みで取り出す。
    const offsetX = selection.maskWidth === docWidth ? 0 : selection.x;
    const offsetY = selection.maskHeight === docHeight ? 0 : selection.y;
    const x0 = Math.max(0, Math.floor(tile.x - offsetX) - 1);
    const y0 = Math.max(0, Math.floor(tile.y - offsetY) - 1);
    const x1 = Math.min(selection.maskWidth, Math.ceil(tile.x + tile.w - offsetX) + 1);
    const y1 = Math.min(selection.maskHeight, Math.ceil(tile.y + tile.h - offsetY) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const pixels = new ImageData(x1 - x0, y1 - y0);
    for (let row = 0; row < pixels.height; row += 1) {
      const start = ((y0 + row) * selection.maskWidth + x0) * 4;
      pixels.data.set(selection.data.subarray(start, start + pixels.width * 4), row * pixels.width * 4);
    }
    const source = canvasFor({ x: 0, y: 0, w: pixels.width, h: pixels.height });
    try {
      source.getContext("2d")!.putImageData(pixels, 0, 0);
      ctx.drawImage(source, offsetX + x0 - tile.x, offsetY + y0 - tile.y);
    } finally {
      source.width = source.height = 0;
    }
  }
}

export function restoreStrokeSelection(
  store: TileStore,
  history: History,
  layerId: string,
  selection: Selection,
  eraser: boolean
): void {
  if (selection.kind !== "polygon" && selection.kind !== "mask") return;
  if (selection.kind === "polygon" && selection.points.length < 3) return;
  const pending = history.getPendingRegion();
  if (!pending) return;
  history.forEachPendingBeforeTile(layerId, null, (before, tile) => {
    const region = intersect(tile, pending);
    if (!region) return;
    const mask = canvasFor(tile);
    const after = canvasFor(tile);
    const original = canvasFor(tile);
    try {
      drawSelectionMask(mask.getContext("2d")!, selection, tile, store.width, store.height);
      const actx = after.getContext("2d")!;
      store.drawTo(actx, -tile.x, -tile.y, { x: 0, y: 0, w: tile.w, h: tile.h });
      actx.globalCompositeOperation = "destination-in";
      actx.drawImage(mask, 0, 0);
      const bctx = original.getContext("2d")!;
      bctx.putImageData(before, 0, 0);
      store.withCtx((ctx) => {
        ctx.clearRect(tile.x, tile.y, tile.w, tile.h);
        ctx.drawImage(original, tile.x, tile.y);
        // 旧経路と同じ合成順序を維持する。before は履歴の正本なので変更しない。
        if (eraser) {
          bctx.globalCompositeOperation = "destination-out";
          bctx.drawImage(after, 0, 0);
          bctx.globalCompositeOperation = "destination-in";
          bctx.drawImage(mask, 0, 0);
          ctx.globalCompositeOperation = "destination-out";
          ctx.drawImage(original, tile.x, tile.y);
        } else {
          ctx.drawImage(after, tile.x, tile.y);
        }
      }, region);
    } finally {
      mask.width = mask.height = 0;
      after.width = after.height = 0;
      original.width = original.height = 0;
    }
  });
}
