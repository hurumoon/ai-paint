import { PaintDocument } from "./PaintDocument";
import { History } from "./History";
import { Timelapse } from "./Timelapse";
import { TileStore } from "./TileStore";
import {
  blurWorker,
  linearGradientWorker,
  radialGradientWorker,
} from "../workers/paintWorkerClient";
import {
  estimateRectDrawingAmount,
  recordDrawingActivity,
} from "./drawingActivity";
import { GradientKind, GradientPreset, ShapeKind, Selection } from "../types";
import { buildPresetStops } from "./gradientPresets";
import { applyTransparentPixelLock } from "./transparentPixelLock";

// ===== 共通ユーティリティ =====
export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      alpha,
    ];
  }
  return [0, 0, 0, alpha];
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// 選択マスクを描いた canvas を返す（白=選択範囲、透明=非選択）
// rect/polygon/mask 共通でマスク画像を一発で作る
function buildSelectionMaskCanvas(
  selection: Selection,
  docWidth: number,
  docHeight: number
): HTMLCanvasElement | null {
  if (selection.kind === "none") return null;
  const c = document.createElement("canvas");
  c.width = docWidth;
  c.height = docHeight;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  if (selection.kind === "rect") {
    if (selection.w <= 0 || selection.h <= 0) return null;
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
  } else if (selection.kind === "polygon") {
    if (selection.points.length < 3) return null;
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x, selection.points[0].y);
    for (let i = 1; i < selection.points.length; i += 1) {
      ctx.lineTo(selection.points[i].x, selection.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (selection.kind === "mask") {
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
    ctx.drawImage(tmp, offsetX, offsetY);
  }
  return c;
}

// 選択範囲の doc 座標 bbox を返す。kind === "none" や空の場合は doc 全域を返す。
// TileStore の withCtx hint や合成最適化の touch 範囲推定に使う。
export function selectionBBox(
  selection: Selection,
  docWidth: number,
  docHeight: number
): { x: number; y: number; w: number; h: number } {
  if (selection.kind === "rect" || selection.kind === "polygon" || selection.kind === "mask") {
    if (selection.w > 0 && selection.h > 0) {
      const x = Math.max(0, Math.floor(selection.x));
      const y = Math.max(0, Math.floor(selection.y));
      const w = Math.min(docWidth - x, Math.ceil(selection.w));
      const h = Math.min(docHeight - y, Math.ceil(selection.h));
      return { x, y, w, h };
    }
  }
  return { x: 0, y: 0, w: docWidth, h: docHeight };
}

// 一時canvasに描いた内容を、selection範囲に絞ってlayerに合成する
export function compositeWithSelection(
  layerStore: TileStore,
  layerWidth: number,
  layerHeight: number,
  selection: Selection,
  draw: (tmpCtx: CanvasRenderingContext2D) => void,
  options: { preserveTransparentPixels?: boolean } = {}
): void {
  const tmp = document.createElement("canvas");
  tmp.width = layerWidth;
  tmp.height = layerHeight;
  const tctx = tmp.getContext("2d")!;
  draw(tctx);

  const maskCanvas = buildSelectionMaskCanvas(selection, layerWidth, layerHeight);
  if (maskCanvas) {
    tctx.save();
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(maskCanvas, 0, 0);
    tctx.restore();
  }

  // tmp の有効ピクセルは selection bbox に限られる (destination-in で外側はクリアされる)
  // ので、Phase 3 タイル化時に必要なタイルだけ materialize できるよう hint を渡す。
  const bbox = selectionBBox(selection, layerWidth, layerHeight);
  const before = options.preserveTransparentPixels
    ? layerStore.getImageData(bbox.x, bbox.y, bbox.w, bbox.h)
    : null;
  layerStore.withCtx((ctx) => {
    (ctx as CanvasRenderingContext2D).drawImage(tmp, 0, 0);
  }, bbox);
  if (before) {
    const after = layerStore.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    applyTransparentPixelLock(before, after);
    layerStore.putImageData(after, bbox.x, bbox.y);
  }
}

// ===== ぼかし =====
export async function applyBlur(
  doc: PaintDocument,
  history: History,
  timelapse: Timelapse,
  radius: number,
  selection: Selection
): Promise<void> {
  const layer = doc.getActiveLayer();
  if (!layer || layer.meta.locked || layer.meta.kind === "group") return;
  history.beginOperation(doc, [layer.meta.id]);
  try {
    const bbox = selectionBBox(selection, doc.width, doc.height);
    const before = layer.store.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    const after = await blurWorker(before, radius);
    if (layer.meta.transparentPixelLock) {
      applyTransparentPixelLock(before, after);
    }

    if (selection.kind === "polygon" || selection.kind === "mask") {
      // bbox にぼかし結果を持つ一時canvasを作り、選択マスクで切り抜き、layerに重ねる
      const tmp = document.createElement("canvas");
      tmp.width = doc.width;
      tmp.height = doc.height;
      const tctx = tmp.getContext("2d")!;
      tctx.putImageData(after, bbox.x, bbox.y);

      const maskCanvas = buildSelectionMaskCanvas(selection, doc.width, doc.height);
      if (maskCanvas) {
        tctx.save();
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(maskCanvas, 0, 0);
        tctx.restore();
      }

      // 選択範囲だけ元レイヤーから消してから、ぼかし結果を上から描画
      // （ぼかしは置換系操作なので、選択範囲の中身を完全に差し替える）
      if (maskCanvas) {
        layer.store.withCtx((ctx) => {
          (ctx as CanvasRenderingContext2D).globalCompositeOperation = "destination-out";
          (ctx as CanvasRenderingContext2D).drawImage(maskCanvas, 0, 0);
        }, bbox);
      }
      layer.store.withCtx((ctx) => {
        (ctx as CanvasRenderingContext2D).drawImage(tmp, 0, 0);
      }, bbox);
      if (layer.meta.transparentPixelLock) {
        const lockedAfter = layer.store.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
        applyTransparentPixelLock(before, lockedAfter);
        layer.store.putImageData(lockedAfter, bbox.x, bbox.y);
      }
    } else {
      // rect / none は単純に bbox を putImageData で上書き
      layer.store.putImageData(after, bbox.x, bbox.y);
    }

    doc.invalidateActive();
    history.commitOperation(doc, `ぼかし r=${radius}`, [layer.meta.id]);
    recordDrawingActivity(estimateRectDrawingAmount(bbox, doc.width, doc.height));
    await timelapse.captureIfEnabled(doc);
  } catch (e) {
    history.cancelOperation();
    throw e;
  }
}

// ===== グラデーション =====
export async function applyGradient(
  doc: PaintDocument,
  history: History,
  timelapse: Timelapse,
  kind: GradientKind,
  from: { x: number; y: number; color: string; alpha: number },
  to: { x: number; y: number; color: string; alpha: number },
  selection: Selection,
  preset: GradientPreset = "two-color"
): Promise<void> {
  const layer = doc.getActiveLayer();
  if (!layer || layer.meta.locked || layer.meta.kind === "group") return;
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) {
    return;
  }

  history.beginOperation(doc, [layer.meta.id]);
  try {
    const fromRgba = hexToRgba(from.color, Math.round(from.alpha * 255));
    const toRgba = hexToRgba(to.color, Math.round(to.alpha * 255));
    const stops = buildPresetStops(preset, from.alpha, to.alpha);

    let imageData: ImageData;
    if (kind === "linear") {
      imageData = await linearGradientWorker(
        doc.width,
        doc.height,
        from.x,
        from.y,
        to.x,
        to.y,
        fromRgba,
        toRgba,
        stops
      );
    } else {
      const r = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
      imageData = await radialGradientWorker(
        doc.width,
        doc.height,
        from.x,
        from.y,
        r,
        fromRgba,
        toRgba,
        stops
      );
    }

    compositeWithSelection(
      layer.store,
      doc.width,
      doc.height,
      selection,
      (tctx) => {
        tctx.putImageData(imageData, 0, 0);
      },
      { preserveTransparentPixels: !!layer.meta.transparentPixelLock }
    );

    doc.invalidateActive();
    const label = preset === "rainbow" ? `グラデーション ${kind} 虹` : `グラデーション ${kind}`;
    history.commitOperation(doc, label, [layer.meta.id]);
    recordDrawingActivity(
      estimateRectDrawingAmount(
        selectionBBox(selection, doc.width, doc.height),
        doc.width,
        doc.height
      )
    );
    await timelapse.captureIfEnabled(doc);
  } catch (e) {
    history.cancelOperation();
    throw e;
  }
}

// ===== 図形 =====
export interface ShapeParams {
  kind: ShapeKind;
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  fill: boolean;
  stroke: boolean;
}

export function drawShape(
  ctx: AnyCtx,
  p: ShapeParams
): void {
  const x = Math.min(p.x1, p.x2);
  const y = Math.min(p.y1, p.y2);
  const w = Math.abs(p.x2 - p.x1);
  const h = Math.abs(p.y2 - p.y1);

  ctx.save();
  if (p.fill) ctx.fillStyle = p.color;
  if (p.stroke) {
    ctx.strokeStyle = p.strokeColor;
    ctx.lineWidth = p.strokeWidth;
  }

  if (p.kind === "rect") {
    if (p.fill) ctx.fillRect(x, y, w, h);
    if (p.stroke) ctx.strokeRect(x, y, w, h);
  } else if (p.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (p.fill) ctx.fill();
    if (p.stroke) ctx.stroke();
  } else if (p.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();
  } else if (p.kind === "polygon") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rOuter = Math.min(w, h) / 2;
    const rInner = rOuter * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? rOuter : rInner;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (p.fill) ctx.fill();
    if (p.stroke) ctx.stroke();
  }
  ctx.restore();
}

export async function commitShape(
  doc: PaintDocument,
  history: History,
  timelapse: Timelapse,
  p: ShapeParams,
  selection: Selection
): Promise<void> {
  const layer = doc.getActiveLayer();
  if (!layer || layer.meta.locked || layer.meta.kind === "group") return;
  if (Math.abs(p.x2 - p.x1) < 1 && Math.abs(p.y2 - p.y1) < 1) return;

  history.beginOperation(doc, [layer.meta.id]);
  try {
    compositeWithSelection(
      layer.store,
      doc.width,
      doc.height,
      selection,
      (tctx) => {
        drawShape(tctx, p);
      },
      { preserveTransparentPixels: !!layer.meta.transparentPixelLock }
    );
    doc.invalidateActive();
    history.commitOperation(doc, `図形 ${p.kind}`, [layer.meta.id]);
    recordDrawingActivity(
      estimateRectDrawingAmount(shapeActivityRect(p), doc.width, doc.height)
    );
    await timelapse.captureIfEnabled(doc);
  } catch (e) {
    history.cancelOperation();
    throw e;
  }
}

function shapeActivityRect(p: ShapeParams): { x: number; y: number; w: number; h: number } {
  const pad = p.stroke ? Math.max(1, p.strokeWidth / 2 + 1) : 1;
  const x1 = Math.min(p.x1, p.x2) - pad;
  const y1 = Math.min(p.y1, p.y2) - pad;
  const x2 = Math.max(p.x1, p.x2) + pad;
  const y2 = Math.max(p.y1, p.y2) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// ===== マジックワンド =====
// tolerance: RGB はユークリッド距離、αは絶対差で判定する許容値
// contiguous: true なら連続領域、false なら画像全体の色域選択
export function magicWandMask(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  contiguous: boolean = true
): {
  data: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const { width, height, data } = imageData;
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const idx = (sy * width + sx) * 4;
  const tr = data[idx];
  const tg = data[idx + 1];
  const tb = data[idx + 2];
  const ta = data[idx + 3];
  const tol2 = tolerance * tolerance;

  const mask = new Uint8ClampedArray(width * height * 4);
  let minX = sx, minY = sy, maxX = sx, maxY = sy;
  let hit = false;

  const matches = (di: number): boolean => {
    const dr = data[di] - tr;
    const dg = data[di + 1] - tg;
    const db = data[di + 2] - tb;
    const da = data[di + 3] - ta;
    if (Math.abs(da) > tolerance) return false;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  if (!contiguous) {
    // 全画像から色域に合致するピクセルを抽出（連結しない）
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        const di = p * 4;
        if (matches(di)) {
          mask[di] = 0;
          mask[di + 1] = 0;
          mask[di + 2] = 0;
          mask[di + 3] = 255;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          hit = true;
        }
      }
    }
  } else {
    const visited = new Uint8Array(width * height);
    const stack: number[] = [];
    stack.push(sy * width + sx);
    visited[sy * width + sx] = 1;

    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % width;
      const py = (p - px) / width;
      const di = p * 4;
      if (!matches(di)) continue;
      mask[di] = 0;
      mask[di + 1] = 0;
      mask[di + 2] = 0;
      mask[di + 3] = 255;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      hit = true;
      if (px > 0) {
        const np = p - 1;
        if (!visited[np]) { visited[np] = 1; stack.push(np); }
      }
      if (px < width - 1) {
        const np = p + 1;
        if (!visited[np]) { visited[np] = 1; stack.push(np); }
      }
      if (py > 0) {
        const np = p - width;
        if (!visited[np]) { visited[np] = 1; stack.push(np); }
      }
      if (py < height - 1) {
        const np = p + width;
        if (!visited[np]) { visited[np] = 1; stack.push(np); }
      }
    }
  }

  if (!hit) return null;

  return {
    data: mask,
    maskWidth: width,
    maskHeight: height,
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

// ===== ポリゴンの bbox 計算 =====
export function polygonBBox(points: { x: number; y: number }[]): {
  x: number; y: number; w: number; h: number;
} {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// 選択マスクをブラシ用にキャッシュ。Canvas側はストローク開始時にこのcanvasを作って
// 終了時に layer に「ストローク後の差分だけを mask で切り抜いて適用」する仕組みで使う。
export function selectionMaskCanvas(
  selection: Selection,
  docWidth: number,
  docHeight: number
): HTMLCanvasElement | null {
  return buildSelectionMaskCanvas(selection, docWidth, docHeight);
}
