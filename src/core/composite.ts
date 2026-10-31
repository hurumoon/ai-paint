import type { PaintDocument, PixelLayer } from "./PaintDocument";
import { sharedCanvasPool } from "./canvasPool";
import {
  compositeBlendPixel,
  isCustomBlendMode,
  type NativeBlendMode,
} from "./blendModes";
import type { BlendMode } from "../types";

// 描画に必要な読み取り専用の面だけを受け取り、縮小表示でも同じ合成規則を使う。
type CompositeDocument = Pick<PaintDocument, "width" | "height">;
export interface CompositeLayer {
  meta: PixelLayer["meta"];
  store: Pick<PixelLayer["store"], "width" | "height" | "drawTo" | "getAlphaBounds">;
  deferred?: Pick<NonNullable<PixelLayer["deferred"]>,
    "offsetX" | "offsetY" | "bboxWidth" | "bboxHeight">;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// BlendMode → Canvas2D globalCompositeOperation。
// ほとんどは文字列がそのまま使えるが、"linear-dodge" (加算/発光) だけは
// Canvas API 側で "lighter" として実装されているため翻訳が必要。
export function toCompositeOp(mode: NativeBlendMode): GlobalCompositeOperation {
  if (mode === "linear-dodge") return "lighter";
  return mode as GlobalCompositeOperation;
}

interface PooledBuf {
  canvas: AnyCanvas;
  ctx: AnyCtx;
}

interface CompositeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 中間 canvas の確保サイズと translate オフセットを destClip / contentBounds から決める。
// どちらも無い時は doc サイズで持つ (従来挙動)。
// 矩形がある時はそのサイズで確保し、ctx を doc 座標で動くように translate する。
//   - 内部の drawLayerPixels / 再帰 compositeLayers は doc 座標で書き込むだけで済む。
//   - 親 ctx に貼り戻す drawImage は `(destClip.x, destClip.y)` を渡す
//     (rect が doc 内の同じ位置を表現しているので、親 ctx 側が doc 座標ならそこに置く)。
// 確保メモリは O(destClip 面積) になり、ブラシストローク中の深いネストでも doc サイズの
// 中間が D-1 枚溜まるのを回避できる。
//
// destClip の幅 or 高さが 0 以下なら null を返す (呼び出し側で何もしないで返る)。
interface InterShape {
  w: number;
  h: number;
  // 親 ctx に貼るときの doc 座標位置 (translate 量の逆)
  dx: number;
  dy: number;
  // ctx を doc 座標で扱うための translate 量 (矩形で絞った経路でのみ非ゼロ)
  tx: number;
  ty: number;
  // 子の drawTo / 再帰 compositeLayers に渡す doc 座標の描画範囲。
  clip: CompositeRect;
}

interface BoundsCache {
  layer: Map<string, CompositeRect | null>;
  store: WeakMap<CompositeLayer["store"], CompositeRect | null>;
}

function createBoundsCache(): BoundsCache {
  return {
    layer: new Map(),
    store: new WeakMap(),
  };
}

function normalizeRect(rect: CompositeRect): CompositeRect | null {
  const x0 = Math.floor(rect.x);
  const y0 = Math.floor(rect.y);
  const x1 = Math.ceil(rect.x + rect.w);
  const y1 = Math.ceil(rect.y + rect.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clampRectToDoc(doc: CompositeDocument, rect: CompositeRect): CompositeRect | null {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  const x0 = Math.max(0, normalized.x);
  const y0 = Math.max(0, normalized.y);
  const x1 = Math.min(doc.width, normalized.x + normalized.w);
  const y1 = Math.min(doc.height, normalized.y + normalized.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function intersectRects(a: CompositeRect, b: CompositeRect): CompositeRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function unionRects(
  a: CompositeRect | null,
  b: CompositeRect | null
): CompositeRect | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function intermediateShape(
  doc: CompositeDocument,
  destClip: CompositeRect | undefined,
  contentBounds?: CompositeRect | null
): InterShape | null {
  const docRect: CompositeRect = { x: 0, y: 0, w: doc.width, h: doc.height };
  let rect = contentBounds ? clampRectToDoc(doc, contentBounds) : docRect;
  if (!rect) return null;
  if (destClip) {
    const normalizedClip = clampRectToDoc(doc, destClip);
    if (!normalizedClip) return null;
    rect = intersectRects(rect, normalizedClip);
    if (!rect) return null;
  }
  return {
    w: rect.w,
    h: rect.h,
    dx: rect.x,
    dy: rect.y,
    tx: -rect.x,
    ty: -rect.y,
    clip: rect,
  };
}

function acquireIntermediate(shape: InterShape): PooledBuf {
  const buf = sharedCanvasPool.acquire(shape.w, shape.h);
  if (shape.tx !== 0 || shape.ty !== 0) {
    buf.ctx.save();
    buf.ctx.translate(shape.tx, shape.ty);
  }
  return buf;
}

function releaseIntermediate(buf: PooledBuf, shape: InterShape): void {
  if (shape.tx !== 0 || shape.ty !== 0) {
    // acquireIntermediate で save した分を戻す。
    // 次回 pool.acquire で setTransform リセットされるが、念のため対称性を保つ。
    buf.ctx.restore();
  }
  sharedCanvasPool.release(buf);
}

function shapeFromRect(rect: CompositeRect): InterShape | null {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  return {
    w: normalized.w,
    h: normalized.h,
    dx: normalized.x,
    dy: normalized.y,
    tx: -normalized.x,
    ty: -normalized.y,
    clip: normalized,
  };
}

interface DrawableStore {
  readonly width: number;
  readonly height: number;
  drawTo(
    destCtx: AnyCtx,
    dx: number,
    dy: number,
    destClip?: { x: number; y: number; w: number; h: number }
  ): void;
}

function drawBounds(
  store: DrawableStore,
  dx: number,
  dy: number,
  destClip?: CompositeRect,
  contentBounds?: CompositeRect | null
): CompositeRect | null {
  let rect = contentBounds
    ? normalizeRect(contentBounds)
    : normalizeRect({ x: dx, y: dy, w: store.width, h: store.height });
  if (!rect) return null;
  if (destClip) {
    const clip = normalizeRect(destClip);
    if (!clip) return null;
    rect = intersectRects(rect, clip);
  }
  return rect;
}

function translationFromTransform(ctx: AnyCtx): { x: number; y: number } | null {
  const transform = ctx.getTransform();
  const isSimple =
    Math.abs(transform.a - 1) < 1e-6 &&
    Math.abs(transform.b) < 1e-6 &&
    Math.abs(transform.c) < 1e-6 &&
    Math.abs(transform.d - 1) < 1e-6;
  if (!isSimple) return null;
  return { x: transform.e, y: transform.f };
}

function canvasContext(canvas: AnyCanvas): AnyCtx | null {
  return canvas.getContext("2d") as AnyCtx | null;
}

function transformedPoint(
  transform: DOMMatrixReadOnly,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

function transformedCanvasBounds(
  transform: DOMMatrixReadOnly,
  source: AnyCanvas,
  dx: number,
  dy: number,
  target: AnyCanvas
): CompositeRect | null {
  const x0 = dx;
  const y0 = dy;
  const x1 = dx + source.width;
  const y1 = dy + source.height;
  const points = [
    transformedPoint(transform, x0, y0),
    transformedPoint(transform, x1, y0),
    transformedPoint(transform, x0, y1),
    transformedPoint(transform, x1, y1),
  ];
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const x = Math.max(0, Math.floor(minX) - 1);
  const y = Math.max(0, Math.floor(minY) - 1);
  const right = Math.min(target.width, Math.ceil(maxX) + 1);
  const bottom = Math.min(target.height, Math.ceil(maxY) + 1);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function blendImageData(
  backdrop: ImageData,
  sourceData: ImageData,
  mode: BlendMode,
  alpha: number
): void {
  const b = backdrop.data;
  const s = sourceData.data;
  for (let i = 0; i < b.length; i += 4) {
    const out = compositeBlendPixel(
      mode,
      [b[i], b[i + 1], b[i + 2], b[i + 3]],
      [s[i], s[i + 1], s[i + 2], s[i + 3]],
      alpha
    );
    b[i] = out[0];
    b[i + 1] = out[1];
    b[i + 2] = out[2];
    b[i + 3] = out[3];
  }
}

function copyCanvasUntransformed(ctx: AnyCtx, source: AnyCanvas): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  ctx.restore();
}

function blendCanvasPixelsWithTransform(
  ctx: AnyCtx,
  source: AnyCanvas,
  dx: number,
  dy: number,
  mode: BlendMode,
  alpha: number
): void {
  const targetCanvas = ctx.canvas;
  const transform = ctx.getTransform();
  const bounds = transformedCanvasBounds(transform, source, dx, dy, targetCanvas);
  if (!bounds) return;

  const backdrop = sharedCanvasPool.acquire(targetCanvas.width, targetCanvas.height);
  const transformedSource = sharedCanvasPool.acquire(targetCanvas.width, targetCanvas.height);
  try {
    backdrop.ctx.globalCompositeOperation = "copy";
    backdrop.ctx.drawImage(targetCanvas as CanvasImageSource, 0, 0);

    transformedSource.ctx.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f
    );
    transformedSource.ctx.globalAlpha = 1;
    transformedSource.ctx.globalCompositeOperation = "source-over";
    transformedSource.ctx.drawImage(source as CanvasImageSource, dx, dy);

    const backdropData = backdrop.ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
    const sourceData = transformedSource.ctx.getImageData(
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h
    );
    blendImageData(backdropData, sourceData, mode, alpha);
    backdrop.ctx.putImageData(backdropData, bounds.x, bounds.y);
    copyCanvasUntransformed(ctx, backdrop.canvas);
  } finally {
    sharedCanvasPool.release(transformedSource);
    sharedCanvasPool.release(backdrop);
  }
}

function blendCanvasPixels(
  ctx: AnyCtx,
  source: AnyCanvas,
  dx: number,
  dy: number,
  mode: BlendMode,
  opacity: number
): void {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha <= 0) return;
  const sourceCtx = canvasContext(source);
  if (!sourceCtx) return;

  // Fast path for the renderer's doc-space composite canvases. This path assumes
  // the target ctx has no scale/rotate/skew, so getImageData/putImageData can
  // address the same pixels that drawImage(source, dx, dy) would touch.
  const translation = translationFromTransform(ctx);
  if (!translation) {
    blendCanvasPixelsWithTransform(ctx, source, dx, dy, mode, alpha);
    return;
  }

  let targetX = Math.round(dx + translation.x);
  let targetY = Math.round(dy + translation.y);
  let sourceX = 0;
  let sourceY = 0;
  let width = source.width;
  let height = source.height;
  const targetCanvas = ctx.canvas;

  if (targetX < 0) {
    sourceX -= targetX;
    width += targetX;
    targetX = 0;
  }
  if (targetY < 0) {
    sourceY -= targetY;
    height += targetY;
    targetY = 0;
  }
  width = Math.min(width, targetCanvas.width - targetX);
  height = Math.min(height, targetCanvas.height - targetY);
  if (width <= 0 || height <= 0) return;

  const backdrop = ctx.getImageData(targetX, targetY, width, height);
  const sourceData = sourceCtx.getImageData(sourceX, sourceY, width, height);
  blendImageData(backdrop, sourceData, mode, alpha);
  ctx.putImageData(backdrop, targetX, targetY);
}

export function drawCanvasWithBlendMode(
  ctx: AnyCtx,
  source: AnyCanvas,
  dx: number,
  dy: number,
  mode: BlendMode,
  opacity: number
): void {
  if (isCustomBlendMode(mode)) {
    blendCanvasPixels(ctx, source, dx, dy, mode, opacity);
    return;
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = toCompositeOp(mode);
  ctx.drawImage(source as CanvasImageSource, dx, dy);
  ctx.restore();
}

export function drawStoreWithBlendMode(
  ctx: AnyCtx,
  store: DrawableStore,
  dx: number,
  dy: number,
  mode: BlendMode,
  opacity: number,
  destClip?: CompositeRect,
  contentBounds?: CompositeRect | null
): void {
  if (isCustomBlendMode(mode)) {
    const rect = drawBounds(store, dx, dy, destClip, contentBounds);
    const shape = rect ? shapeFromRect(rect) : null;
    if (!shape) return;
    const source = acquireIntermediate(shape);
    store.drawTo(source.ctx, dx, dy, shape.clip);
    drawCanvasWithBlendMode(ctx, source.canvas, shape.dx, shape.dy, mode, opacity);
    releaseIntermediate(source, shape);
    return;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = toCompositeOp(mode);
  store.drawTo(ctx, dx, dy, destClip);
  ctx.restore();
}

function layerPixelBounds(
  doc: CompositeDocument,
  layer: CompositeLayer,
  cache: BoundsCache
): CompositeRect | null {
  const def = layer.deferred;
  if (def) {
    return clampRectToDoc(doc, {
      x: def.offsetX,
      y: def.offsetY,
      w: def.bboxWidth,
      h: def.bboxHeight,
    });
  }

  const cached = cache.store.get(layer.store);
  if (cached !== undefined) return cached;

  const bounds = layer.store.getAlphaBounds();
  const clamped = bounds ? clampRectToDoc(doc, bounds) : null;
  cache.store.set(layer.store, clamped);
  return clamped;
}

function layerRenderBounds(
  doc: CompositeDocument,
  layers: CompositeLayer[],
  layer: CompositeLayer,
  cache: BoundsCache
): CompositeRect | null {
  const cached = cache.layer.get(layer.meta.id);
  if (cached !== undefined) return cached;

  let bounds: CompositeRect | null = null;
  if (layer.meta.visible) {
    bounds =
      layer.meta.kind === "group"
        ? compositeBounds(doc, layers, layer.meta.id, cache)
        : layerPixelBounds(doc, layer, cache);
  }

  cache.layer.set(layer.meta.id, bounds);
  return bounds;
}

function compositeBounds(
  doc: CompositeDocument,
  layers: CompositeLayer[],
  parentIdFilter: string | undefined,
  cache: BoundsCache
): CompositeRect | null {
  const siblings = layers.filter((l) => l.meta.parentId === parentIdFilter);
  let bounds: CompositeRect | null = null;

  let i = 0;
  while (i < siblings.length) {
    const base = siblings[i];
    const clips: CompositeLayer[] = [];
    let j = i + 1;
    while (j < siblings.length && siblings[j].meta.clippingMask) {
      clips.push(siblings[j]);
      j += 1;
    }

    const baseIsOrphanClip = base.meta.clippingMask;
    if (!base.meta.visible && !baseIsOrphanClip) {
      i = j;
      continue;
    }

    if (clips.length === 0 || baseIsOrphanClip) {
      bounds = unionRects(bounds, layerRenderBounds(doc, layers, base, cache));
      if (baseIsOrphanClip) {
        for (const c of clips) {
          bounds = unionRects(bounds, layerRenderBounds(doc, layers, c, cache));
        }
      }
      i = j;
      continue;
    }

    // クリップグループの最終出力はベースの alpha 範囲内に切り落とされる。
    bounds = unionRects(bounds, layerRenderBounds(doc, layers, base, cache));
    i = j;
  }

  return bounds;
}

// レイヤー配列を順に合成する。parentId === parentIdFilter のものだけを対象とし、
// グループに当たったらそのグループ配下を再帰的に別 canvas に合成してから親に貼り直す。
// これで「グループの opacity/blendMode を子合成後に適用」が成立する。
//
// クリッピングマスク:
//   meta.clippingMask=true のレイヤーは、その直下（配列上 1 つ前）の同じ親に属する
//   非クリップレイヤー（= ベース）の不透明部分にのみ表示される。連続して true が並ぶと
//   同じベースに重ねてクリップ（Photoshop と同じ挙動）。
//   ベースの blendMode/opacity はクリップ合成後に下地へ適用する。
//
// 注: `parentIdFilter` は通常 undefined（トップレベル）で呼び出す。ネストグループは内部の再帰で処理される。
//
// パフォーマンス: グループ / クリップ用の一時 canvas は sharedCanvasPool から借りて、
// 使い終わったら即 release する。doc サイズの new OffscreenCanvas() を毎フレーム作ると
// 重いPSDで GC 圧力と確保コストが効いてくる。
//
// destClip (dest = doc 座標系) を渡すと:
//   - 各 PixelLayer の drawTo がタイル enumerate 時にその矩形と交差しないタイルをスキップ
//   - 一時 canvas (aBuf/mBuf/gBuf) は destClip サイズで確保される (doc サイズではなく)
// これにより、ストローク中の dirty rect が小さい時は、深いネストでも一時 canvas が
// rect サイズに収まる。CanvasRenderer.drawFastPath の fallback 経路や、scope k=0 で
// pivot がグループの場合に効く。
// ctx 側に clip(rect) が無くても安全 (タイル絞り込みのフィルタとしてのみ働く)。
export function compositeLayers(
  ctx: AnyCtx,
  doc: CompositeDocument,
  layers: CompositeLayer[],
  parentIdFilter: string | undefined,
  destClip?: { x: number; y: number; w: number; h: number },
  boundsCache: BoundsCache = createBoundsCache(),
  optimizeIntermediates: boolean = destClip === undefined
): void {
  const rootShape = intermediateShape(doc, destClip);
  if (!rootShape) return;
  const rootClip = rootShape.clip;
  const drawClip = destClip ? rootClip : undefined;

  // 同じ親階層のレイヤーだけを抽出（配列順 = 下から上）
  const siblings = layers.filter((l) => l.meta.parentId === parentIdFilter);

  let i = 0;
  while (i < siblings.length) {
    const base = siblings[i];
    // base 上に積まれる連続クリップを集める
    const clips: CompositeLayer[] = [];
    let j = i + 1;
    while (j < siblings.length && siblings[j].meta.clippingMask) {
      clips.push(siblings[j]);
      j += 1;
    }

    // base 自身がクリップフラグを持つ場合 = 下にベースが居ない一番下のレイヤー。
    // 行き場がないので通常レイヤーとして扱う（Photoshop も同じ）。
    const baseIsOrphanClip = base.meta.clippingMask;

    // ベース不可視 = クリップグループ全体も不可視（Photoshop 仕様）。早期 skip。
    // 孤立クリップの連鎖時は base を通常扱いするので、その場合は個別判定に委ねる。
    if (!base.meta.visible && !baseIsOrphanClip) {
      i = j;
      continue;
    }

    if (clips.length === 0 || baseIsOrphanClip) {
      // クリップなし or 孤立クリップ: 単純描画 / グループ再帰
      if (base.meta.visible) {
        drawLayer(ctx, doc, base, layers, drawClip, boundsCache, optimizeIntermediates);
      }
      // 孤立クリップに連なるクリップも、ベースがいない扱いなので通常描画する
      if (baseIsOrphanClip) {
        for (const c of clips) {
          if (c.meta.visible) {
            drawLayer(ctx, doc, c, layers, drawClip, boundsCache, optimizeIntermediates);
          }
        }
      }
      i = j;
      continue;
    }

    // クリップグループ:
    //   1. オフスクリーン A にベースの「素のピクセル」を描く（alpha=1, blend=normal）
    //   2. その alpha を覚えるためのマスク M を作る（A をコピー）
    //   3. クリップ各層を A 上に各自の blend/opacity で重ねる
    //   4. A に destination-in で M を貼って、ベース alpha の範囲外を切り落とす
    //   5. A をターゲット ctx にベースの blend/opacity で貼る
    //
    // destClip 適用時の挙動:
    //   - A / M / 各 gBuf は destClip サイズで確保される。translate で doc 座標で
    //     書き込めるので、内部の drawLayerPixels / 再帰 compositeLayers は変わらない。
    //   - drawTo はタイル粒度のフィルタなので、destClip rect と交差するタイル全体が
    //     emit される。タイル境界に丸めた spill が A / M に残るが、
    //       - M = A のコピーなので spill は同じ形 → (4) の destination-in で整合
    //       - 最終的に (5) で ctx に貼るときは、CanvasRenderer 側で ctx に clip(rect) が
    //         掛かっているので spill 部分は可視出力に出ない
    //     の二段で吸収される。
    //   - 親 ctx へ貼る `drawImage(A, dx, dy)` の dx/dy は destClip 位置で、ctx 側も
    //     doc 座標前提なので OK (ctx も上位 compositeLayers から translate 済みかも
    //     しれない)。
    const clipShape = optimizeIntermediates
      ? intermediateShape(doc, drawClip, layerRenderBounds(doc, layers, base, boundsCache))
      : intermediateShape(doc, rootClip);
    if (!clipShape) {
      i = j;
      continue;
    }

    const aBuf = acquireIntermediate(clipShape);
    const A = aBuf.canvas;
    const aCtx = aBuf.ctx;

    // (1) ベース描画。グループなら再帰合成、それ以外は素描き。
    if (base.meta.kind === "group") {
      compositeLayers(
        aCtx,
        doc,
        layers,
        base.meta.id,
        clipShape.clip,
        boundsCache,
        optimizeIntermediates
      );
    } else {
      drawLayerPixels(aCtx, base, clipShape.clip);
    }

    // (2) マスク M を作る (A の現状を doc 座標で M に貼る = (shape.dx, shape.dy))
    const mBuf = acquireIntermediate(clipShape);
    const M = mBuf.canvas;
    const mCtx = mBuf.ctx;
    mCtx.drawImage(A as CanvasImageSource, clipShape.dx, clipShape.dy);

    // (3) クリップ各層を A 上に重ねる
    for (const c of clips) {
      if (!c.meta.visible) continue;
      if (c.meta.kind === "group") {
        const gBuf = acquireIntermediate(clipShape);
        compositeLayers(
          gBuf.ctx,
          doc,
          layers,
          c.meta.id,
          clipShape.clip,
          boundsCache,
          optimizeIntermediates
        );
        drawCanvasWithBlendMode(
          aCtx,
          gBuf.canvas,
          clipShape.dx,
          clipShape.dy,
          c.meta.blendMode,
          c.meta.opacity
        );
        releaseIntermediate(gBuf, clipShape);
      } else {
        drawLayerPixelsWithBlendMode(
          aCtx,
          c,
          c.meta.blendMode,
          c.meta.opacity,
          clipShape.clip,
          layerRenderBounds(doc, layers, c, boundsCache)
        );
      }
    }

    // (4) ベース alpha でマスク
    aCtx.save();
    aCtx.globalCompositeOperation = "destination-in";
    aCtx.drawImage(M as CanvasImageSource, clipShape.dx, clipShape.dy);
    aCtx.restore();

    // (5) ターゲットに描画
    drawCanvasWithBlendMode(
      ctx,
      A,
      clipShape.dx,
      clipShape.dy,
      base.meta.blendMode,
      base.meta.opacity
    );

    releaseIntermediate(mBuf, clipShape);
    releaseIntermediate(aBuf, clipShape);

    i = j;
  }
}

// 単一レイヤーをターゲット ctx に描く（グループ再帰含む）。
//
// destClip 適用時の前提: PSD レイヤーの blendMode (normal / multiply / screen /
// overlay / darken / lighten / color-dodge / color-burn / subtract / hard-light /
// soft-light / difference / exclusion / hue / saturation / color / luminosity) はいずれも
// 「src が透明 = 何も描かない」と等価な合成式 (源側 alpha=0 で dst が変化しない)。
// destClip がタイル単位で「外側タイルを skip = 透明描画と等価」になるのはこの前提に
// 依存している。将来 source-in / copy / destination-in など「α=0 で dst を消す」
// composite を blendMode として受け入れる場合は、外側タイルも明示的に clear する
// などの追加処理が必要になる。
//
// destClip が渡されたグループ描画では、子合成用 off も destClip サイズで確保する。
export function drawLayer(
  ctx: AnyCtx,
  doc: CompositeDocument,
  layer: CompositeLayer,
  layers: CompositeLayer[],
  destClip?: { x: number; y: number; w: number; h: number },
  boundsCache: BoundsCache = createBoundsCache(),
  optimizeIntermediates: boolean = destClip === undefined
): void {
  if (layer.meta.kind === "group") {
    const shape = optimizeIntermediates
      ? intermediateShape(doc, destClip, layerRenderBounds(doc, layers, layer, boundsCache))
      : intermediateShape(doc, destClip);
    if (!shape) return;
    // 子をオフスクリーンに合成（透明背景）してから親に貼る。
    // これで「子合成後にグループの opacity/blendMode を適用」できる。
    const off = acquireIntermediate(shape);
    compositeLayers(
      off.ctx,
      doc,
      layers,
      layer.meta.id,
      shape.clip,
      boundsCache,
      optimizeIntermediates
    );
    drawCanvasWithBlendMode(
      ctx,
      off.canvas,
      shape.dx,
      shape.dy,
      layer.meta.blendMode,
      layer.meta.opacity
    );
    releaseIntermediate(off, shape);
  } else {
    drawLayerPixelsWithBlendMode(
      ctx,
      layer,
      layer.meta.blendMode,
      layer.meta.opacity,
      destClip,
      layerRenderBounds(doc, layers, layer, boundsCache)
    );
  }
}

export function drawLayerPixelsWithBlendMode(
  ctx: AnyCtx,
  layer: CompositeLayer,
  mode: BlendMode,
  opacity: number,
  destClip?: { x: number; y: number; w: number; h: number },
  contentBounds?: CompositeRect | null
): void {
  const def = layer.deferred;
  const dx = def && def.bboxWidth > 0 && def.bboxHeight > 0 ? def.offsetX : 0;
  const dy = def && def.bboxWidth > 0 && def.bboxHeight > 0 ? def.offsetY : 0;
  drawStoreWithBlendMode(ctx, layer.store, dx, dy, mode, opacity, destClip, contentBounds);
}

// レイヤーの素ピクセルを ctx (= doc座標系) に描く。
// PSD ロード時の遅延レイヤー (store が bbox サイズで保持されている) は offset 付きで貼る。
// 通常レイヤー (store が doc サイズ) は (0, 0) に貼る。
// `store.drawTo` を経由するのは TileStore タイル化への布石。
// Phase 2 でタイル化されると drawTo が影響タイル enumerate に置き換わるが、
// composite 側からの呼び出し形は変わらない。
// destClip は dest 座標系の矩形。タイル化レイヤーの drawTo に渡されて、ストローク中の
// 全タイル enumerate を回避する。deferred の offset 越しでも doc 座標で動くので、
// store の内部タイル位置の計算は drawTo 側 (= (dx, dy) + tile 位置) が吸収する。
export function drawLayerPixels(
  ctx: AnyCtx,
  layer: CompositeLayer,
  destClip?: { x: number; y: number; w: number; h: number }
): void {
  const def = layer.deferred;
  if (def && def.bboxWidth > 0 && def.bboxHeight > 0) {
    layer.store.drawTo(ctx, def.offsetX, def.offsetY, destClip);
  } else {
    layer.store.drawTo(ctx, 0, 0, destClip);
  }
}
