// レイヤーピクセルの保管庫。
//
// Phase 3 (現在): 内部は TILE_SIZE×TILE_SIZE のスパースタイル集合
// (Map<key, Tile>)。書き込みが起きたタイルだけが OffscreenCanvas として
// 実体化され、空のレイヤー/領域はメモリを消費しない。
// 読み出し (drawTo / getImageData / 各種スナップショット) は影響タイルだけを
// enumerate して dest に合成する。書き込み (withCtx / putImageData /
// clearRect) は影響タイルを必要に応じて materialize し、書き込み後に
// flat キャッシュを破棄する。
//
// `fromCanvas` で外部 canvas を取り込む経路は「ゼロコピー adoption」を
// 維持するため、その canvas を `flatBacking` として保持したまま tiles は
// 空のままにする。最初の書き込みでは hint に交差するタイルだけを切り出し、
// 未編集タイルは flatBacking から読み続ける。これにより「PSD を開いて即保存」
// のような編集しないパスでは drawImage コピーが発生しない。
//
// 旧 API の `canvas` / `ctx` ゲッタ、`toHtmlCanvasSnapshot`、`toPngBytes`
// は「全タイル合成 → 単一 canvas」のフォールバックとして残る。呼び出し側は
// 可能な限り `drawTo` / `withCtx` / `getImageData` / `putImageData` /
// `clearRect` を経由して、タイル enumerate の恩恵を受けられるようにする。

import {
  rectsIntersect,
  TILE_SIZE,
  tileKey,
  type Rect,
} from "./tileStoreGeometry";
import {
  ALPHA_BOUNDS_SCAN_PIXELS,
  scanAlphaBounds,
  type AlphaBounds,
} from "./tileStoreAlpha";
import { htmlCanvasToBlob } from "./canvasEncoding";

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface Tile {
  canvas: AnyCanvas;
  ctx: AnyCtx;
}

interface ClampedDocRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TileRange {
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

function createBackingCanvas(width: number, height: number): {
  canvas: AnyCanvas;
  ctx: AnyCtx;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d", { willReadFrequently: false })!;
    return { canvas: c, ctx };
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  return { canvas: c, ctx };
}


export class TileStore {
  readonly width: number;
  readonly height: number;

  // タイル分割数
  private tilesX: number;
  private tilesY: number;

  // スパースタイルストレージ。書き込みが起きたタイルだけ存在する。
  private tiles: Map<number, Tile> = new Map();

  // 外部から取り込んだ「権威的な」フラット canvas。fromCanvas 経由で設定され、
  // tiles に切り出していない領域の正本として残す。一部タイル化後は tiles 側が
  // そのタイル範囲の正本になり、flatBacking は未編集タイルの正本として併用する。
  private flatBacking: Tile | null = null;

  // 読み出し用フラットキャッシュ。canvas/ctx ゲッタや toHtmlCanvasSnapshot/
  // toPngBytes が呼ばれた時にタイルから合成して保存する。書き込みで破棄。
  // flatBacking とは別概念: flatBacking は権威、flatCache は再生成可能なキャッシュ。
  private flatCache: Tile | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tilesX = Math.max(1, Math.ceil(width / TILE_SIZE));
    this.tilesY = Math.max(1, Math.ceil(height / TILE_SIZE));
  }

  // 外部で既に描画済みの canvas をそのまま採用する。tiles はまだ作らず、
  // 読み出しはこの canvas を直接使う。最初の書き込みが起きた時点で初めて
  // 必要なタイルだけ分割が走る。
  // PSD ローダーが用意した HTMLCanvas や deferred 用の小さい canvas は
  // 多くの場合「読み出し → そのまま保存」だけで終わるので、その経路では
  // タイル分割コストを完全に回避できる。
  static fromCanvas(canvas: AnyCanvas, ctx: AnyCtx): TileStore {
    const instance = new TileStore(canvas.width, canvas.height);
    instance.flatBacking = { canvas, ctx };
    return instance;
  }

  // タイル化された後のメンテで内部実装が変わっても外部から検知できるよう、
  // 旧 API の`canvas` / `ctx` ゲッタは残しているが、新規コードは原則使わない
  // (タイル化済みの場合は「全タイル合成 → 単一 canvas」のキャッシュ生成が走る)。
  get canvas(): AnyCanvas {
    return this.ensureFlat().canvas;
  }

  get ctx(): AnyCtx {
    return this.ensureFlat().ctx;
  }

  // ===== 公開 read API =====

  // 指定範囲と交差するタイル全体の doc 座標を列挙する。
  // 履歴はこの単位で before/after を保存することで、ストローク開始時に
  // doc 全域の clone canvas を持たずに済ませる。
  forEachTileRectInDocRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fn: (rect: Rect) => void
  ): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    if (x0 >= x1 || y0 >= y1) return;
    const tx0 = Math.floor(x0 / TILE_SIZE);
    const ty0 = Math.floor(y0 / TILE_SIZE);
    const tx1 = Math.floor((x1 - 1) / TILE_SIZE);
    const ty1 = Math.floor((y1 - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tileDocX = tx * TILE_SIZE;
        const tileDocY = ty * TILE_SIZE;
        const tileW = Math.min(TILE_SIZE, this.width - tileDocX);
        const tileH = Math.min(TILE_SIZE, this.height - tileDocY);
        if (tileW <= 0 || tileH <= 0) continue;
        fn({ x: tileDocX, y: tileDocY, w: tileW, h: tileH });
      }
    }
  }

  // 自身の内容を dest ctx に (dx, dy) で貼る。
  //
  // destClip は dest 座標系の矩形。指定された場合、その矩形に交差しないタイルは
  // drawImage を発行せずスキップする。ストローク中の部分合成で dirty rect を
  // ここに渡せば、密に塗られた tiled レイヤーでも N 回 drawImage を回避できる。
  // destCtx 側に clip(rect) が掛かっていなくても安全 (タイル enumerate のフィルタ
  // としてのみ働き、出力ピクセルの可視性は呼び出し側の clip/composite が決める)。
  drawTo(
    destCtx: AnyCtx,
    dx: number,
    dy: number,
    destClip?: { x: number; y: number; w: number; h: number }
  ): void {
    if (destClip && (destClip.w <= 0 || destClip.h <= 0)) return;
    if (this.flatBacking && this.tiles.size === 0) {
      if (destClip && !rectsIntersect(
        dx, dy, this.flatBacking.canvas.width, this.flatBacking.canvas.height,
        destClip.x, destClip.y, destClip.w, destClip.h
      )) {
        return;
      }
      destCtx.drawImage(this.flatBacking.canvas as CanvasImageSource, dx, dy);
      return;
    }
    if (this.flatBacking) {
      const flat = this.flatBacking;
      const drawRect = destClip
        ? this.clampDocRect({
            x: destClip.x - dx,
            y: destClip.y - dy,
            w: destClip.w,
            h: destClip.h,
          })
        : this.clampDocRect();
      if (!drawRect) return;
      const range = this.tileRangeForClampedRect(drawRect);
      for (let ty = range.ty0; ty <= range.ty1; ty += 1) {
        for (let tx = range.tx0; tx <= range.tx1; tx += 1) {
          const tileDocX = tx * TILE_SIZE;
          const tileDocY = ty * TILE_SIZE;
          const destX = dx + tileDocX;
          const destY = dy + tileDocY;
          const tile = this.tiles.get(tileKey(tx, ty, this.tilesX));

          if (tile) {
            if (destClip && !rectsIntersect(
              destX, destY, tile.canvas.width, tile.canvas.height,
              destClip.x, destClip.y, destClip.w, destClip.h
            )) {
              continue;
            }
            destCtx.drawImage(tile.canvas as CanvasImageSource, destX, destY);
            continue;
          }

          const tileW = Math.min(TILE_SIZE, this.width - tileDocX);
          const tileH = Math.min(TILE_SIZE, this.height - tileDocY);
          const srcW = Math.min(tileW, Math.max(0, flat.canvas.width - tileDocX));
          const srcH = Math.min(tileH, Math.max(0, flat.canvas.height - tileDocY));
          if (srcW <= 0 || srcH <= 0) continue;
          if (destClip && !rectsIntersect(
            destX, destY, srcW, srcH,
            destClip.x, destClip.y, destClip.w, destClip.h
          )) {
            continue;
          }
          destCtx.drawImage(
            flat.canvas as CanvasImageSource,
            tileDocX,
            tileDocY,
            srcW,
            srcH,
            destX,
            destY,
            srcW,
            srcH
          );
        }
      }
      return;
    }
    for (const [key, tile] of this.tiles) {
      const tx = key % this.tilesX;
      const ty = (key - tx) / this.tilesX;
      const destX = dx + tx * TILE_SIZE;
      const destY = dy + ty * TILE_SIZE;
      if (destClip && !rectsIntersect(
        destX, destY, tile.canvas.width, tile.canvas.height,
        destClip.x, destClip.y, destClip.w, destClip.h
      )) {
        continue;
      }
      destCtx.drawImage(tile.canvas as CanvasImageSource, destX, destY);
    }
  }

  // 自身の内容を縦横スケールして (dx, dy, dw, dh) で貼る。SubView のサムネ用。
  drawToScaled(
    destCtx: AnyCtx,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    if (this.flatBacking && this.tiles.size === 0) {
      destCtx.drawImage(this.flatBacking.canvas as CanvasImageSource, dx, dy, dw, dh);
      return;
    }
    if (this.width <= 0 || this.height <= 0) return;
    const sx = dw / this.width;
    const sy = dh / this.height;
    if (this.flatBacking) {
      const flat = this.flatBacking;
      for (let ty = 0; ty < this.tilesY; ty += 1) {
        for (let tx = 0; tx < this.tilesX; tx += 1) {
          const tileDocX = tx * TILE_SIZE;
          const tileDocY = ty * TILE_SIZE;
          const tile = this.tiles.get(tileKey(tx, ty, this.tilesX));
          if (tile) {
            destCtx.drawImage(
              tile.canvas as CanvasImageSource,
              dx + tileDocX * sx,
              dy + tileDocY * sy,
              tile.canvas.width * sx,
              tile.canvas.height * sy
            );
            continue;
          }

          const tileW = Math.min(TILE_SIZE, this.width - tileDocX);
          const tileH = Math.min(TILE_SIZE, this.height - tileDocY);
          const srcW = Math.min(tileW, Math.max(0, flat.canvas.width - tileDocX));
          const srcH = Math.min(tileH, Math.max(0, flat.canvas.height - tileDocY));
          if (srcW <= 0 || srcH <= 0) continue;
          destCtx.drawImage(
            flat.canvas as CanvasImageSource,
            tileDocX,
            tileDocY,
            srcW,
            srcH,
            dx + tileDocX * sx,
            dy + tileDocY * sy,
            srcW * sx,
            srcH * sy
          );
        }
      }
      return;
    }
    for (const [key, tile] of this.tiles) {
      const tx = key % this.tilesX;
      const ty = (key - tx) / this.tilesX;
      const tileDocX = tx * TILE_SIZE;
      const tileDocY = ty * TILE_SIZE;
      destCtx.drawImage(
        tile.canvas as CanvasImageSource,
        dx + tileDocX * sx,
        dy + tileDocY * sy,
        tile.canvas.width * sx,
        tile.canvas.height * sy
      );
    }
  }

  // 指定範囲のピクセルを ImageData として返す。
  // 範囲は doc 座標で、範囲をはみ出した部分は (透明) として返る。
  getImageData(x: number, y: number, w: number, h: number): ImageData {
    if (w <= 0 || h <= 0) {
      // 空 ImageData を返す経路は呼び出し側で防ぐ前提だが、安全側に最小サイズで返す。
      const safe = createBackingCanvas(1, 1);
      return safe.ctx.getImageData(0, 0, 1, 1);
    }
    if (this.flatBacking && this.tiles.size === 0) {
      // flatBacking 経路: 全部 1 枚に乗っているので getImageData をそのまま渡せるが、
      // 範囲が canvas をはみ出すと例外になるので、範囲外を含む場合は staging で吸収。
      if (x >= 0 && y >= 0 && x + w <= this.flatBacking.canvas.width && y + h <= this.flatBacking.canvas.height) {
        return this.flatBacking.ctx.getImageData(x, y, w, h);
      }
    }
    // staging に該当範囲だけ集約してから getImageData する。
    const staging = createBackingCanvas(w, h);
    if (this.flatBacking) {
      staging.ctx.drawImage(
        this.flatBacking.canvas as CanvasImageSource,
        -x,
        -y
      );
    }
    this.forEachTileInDocRect(x, y, w, h, (tile, tx, ty, inter) => {
      staging.ctx.clearRect(
        inter.docX - x,
        inter.docY - y,
        inter.tileW,
        inter.tileH
      );
      staging.ctx.drawImage(
        tile.canvas as CanvasImageSource,
        inter.tileX,
        inter.tileY,
        inter.tileW,
        inter.tileH,
        inter.docX - x,
        inter.docY - y,
        inter.tileW,
        inter.tileH
      );
      void tx;
      void ty;
    });
    return staging.ctx.getImageData(0, 0, w, h);
  }

  // 非透明ピクセルを含む最小矩形を返す。完全透明なら null。
  // .aipaint v2 の bbox 保存用。flatBacking はそのまま読み、タイル運用中は
  // 既存タイルだけを走査するため、全域 flat 化を避けられる。
  getAlphaBounds(): Rect | null {
    let bounds: AlphaBounds | null = null;
    if (this.flatBacking && this.tiles.size === 0) {
      const w = this.flatBacking.canvas.width;
      const h = this.flatBacking.canvas.height;
      const rowsPerScan = Math.max(
        1,
        Math.min(h, Math.floor(ALPHA_BOUNDS_SCAN_PIXELS / Math.max(1, w)))
      );
      for (let y = 0; y < h; y += rowsPerScan) {
        const scanH = Math.min(rowsPerScan, h - y);
        bounds = scanAlphaBounds(
          this.flatBacking.ctx.getImageData(0, y, w, scanH),
          0,
          y,
          bounds
        );
      }
    } else if (this.flatBacking) {
      const flat = this.flatBacking;
      for (let ty = 0; ty < this.tilesY; ty += 1) {
        for (let tx = 0; tx < this.tilesX; tx += 1) {
          const key = tileKey(tx, ty, this.tilesX);
          const tile = this.tiles.get(key);
          const tileDocX = tx * TILE_SIZE;
          const tileDocY = ty * TILE_SIZE;
          if (tile) {
            bounds = scanAlphaBounds(
              tile.ctx.getImageData(0, 0, tile.canvas.width, tile.canvas.height),
              tileDocX,
              tileDocY,
              bounds
            );
            continue;
          }

          const tileW = Math.min(TILE_SIZE, this.width - tileDocX);
          const tileH = Math.min(TILE_SIZE, this.height - tileDocY);
          const srcW = Math.min(tileW, Math.max(0, flat.canvas.width - tileDocX));
          const srcH = Math.min(tileH, Math.max(0, flat.canvas.height - tileDocY));
          if (srcW <= 0 || srcH <= 0) continue;
          bounds = scanAlphaBounds(
            flat.ctx.getImageData(tileDocX, tileDocY, srcW, srcH),
            tileDocX,
            tileDocY,
            bounds
          );
        }
      }
    } else {
      for (const [key, tile] of this.tiles) {
        const tx = key % this.tilesX;
        const ty = (key - tx) / this.tilesX;
        bounds = scanAlphaBounds(
          tile.ctx.getImageData(0, 0, tile.canvas.width, tile.canvas.height),
          tx * TILE_SIZE,
          ty * TILE_SIZE,
          bounds
        );
      }
    }
    if (!bounds) return null;
    return {
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.maxX - bounds.minX + 1,
      h: bounds.maxY - bounds.minY + 1,
    };
  }

  // 保持ピクセルの概算バイト数。履歴 (History) がエントリの予算計上に使う。
  // 実体化済みタイルと flatBacking を数え、再生成可能な flatCache は含めない。
  getApproxByteSize(): number {
    let bytes = 0;
    for (const tile of this.tiles.values()) {
      bytes += tile.canvas.width * tile.canvas.height * 4;
    }
    if (this.flatBacking) {
      bytes += this.flatBacking.canvas.width * this.flatBacking.canvas.height * 4;
    }
    return bytes;
  }

  // ===== 公開 write API =====

  // ImageData を (x, y) に貼り付ける。putImageData は globalCompositeOperation や clip を
  // 無視する仕様なので、タイル分割後も「該当範囲を上書き」の意味で実装する。
  putImageData(data: ImageData, x: number, y: number): void {
    const w = data.width;
    const h = data.height;
    if (w <= 0 || h <= 0) return;
    this.beforeWrite({ x, y, w, h });

    // 全タイルを putImageData 相当 (= clip/composite を無視した置き換え) するため、
    // 一度 staging に putImageData してから "copy" composite で各タイルに焼き戻す。
    const staging = createBackingCanvas(w, h);
    staging.ctx.putImageData(data, 0, 0);
    // putImageData は globalCompositeOperation / clip を無視して「該当矩形のみ」を
    // 上書きする。タイル境界をまたぐ場合、各タイルでは「交差矩形だけ」を置き換える必要が
    // あるので、clearRect で対象矩形を透明にしてから source-over で drawImage する
    // (composite "copy" だとタイルの交差外領域までクリアされてしまう)。
    this.forEachTileInDocRect(x, y, w, h, (tile, _tx, _ty, inter) => {
      tile.ctx.save();
      tile.ctx.globalCompositeOperation = "source-over";
      tile.ctx.clearRect(inter.tileX, inter.tileY, inter.tileW, inter.tileH);
      tile.ctx.drawImage(
        staging.canvas as CanvasImageSource,
        inter.docX - x,
        inter.docY - y,
        inter.tileW,
        inter.tileH,
        inter.tileX,
        inter.tileY,
        inter.tileW,
        inter.tileH
      );
      tile.ctx.restore();
    }, { materialize: true });
    this.flatCache = null;
  }

  // 指定範囲を透明にする。範囲外のタイルには触れない (= 解放しない)。
  // 全域クリアの場合は flatBacking / tiles / flatCache をまとめて破棄してメモリを完全解放する。
  clearRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    if (x <= 0 && y <= 0 && x + w >= this.width && y + h >= this.height) {
      // 全域クリア。flatBacking が残っていてもタイル分割せず直接捨てる
      // (分割 → 全タイル clear は無駄なので beforeWrite を呼ばないこと)。
      this.flatBacking = null;
      this.tiles.clear();
      this.flatCache = null;
      return;
    }
    this.beforeWrite({ x, y, w, h });
    this.forEachTileInDocRect(x, y, w, h, (tile, _tx, _ty, inter) => {
      tile.ctx.clearRect(inter.tileX, inter.tileY, inter.tileW, inter.tileH);
    });
    this.flatCache = null;
  }

  // 書き込み時に context state (globalAlpha / globalCompositeOperation / clip 等)
  // を被せる必要があるケース用。
  //
  // hint は触る予定の bbox (doc 座標)。
  //
  // 影響タイルが 1 つだけなら staging を介さずタイル ctx に直接 translate して
  // fn を実行する fast path に乗る。ブラシ毎フレームの hint は概ね segRect で
  // 数十 px 角に収まるので、ほぼこの経路で staging 確保のアロケーションが消える。
  //
  // 複数タイルにまたがる場合は staging (タイル境界に丸めた一時 canvas) を作り、
  // 既存タイル群を staging に集約 → fn 実行 → "copy" composite で各タイルへ
  // 焼き戻す。hint なし or doc 全域 hint は doc 全域 staging で動く (高コスト)。
  //
  // 注意: fn が hint 外に描画した場合、staging / fast path のタイル範囲外なので
  // クリップされて消える。呼び出し側で hint と実際の描画範囲を一致させる責任を負う。
  withCtx(
    fn: (ctx: AnyCtx) => void,
    hint?: { x: number; y: number; w: number; h: number }
  ): void {
    // hint を doc 範囲にクランプ
    const writeRect = this.clampDocRect(hint);
    if (!writeRect) return;
    this.beforeWrite(hint);

    const { tx0, ty0, tx1, ty1 } = this.tileRangeForClampedRect(writeRect);

    // ===== 1 タイル fast path =====
    // hint が 1 タイル内に収まる場合は staging を作らずタイルに直接書く。
    // ブラシ毎フレーム (segRect ~ brushSize+4) はほぼここに乗る。
    if (tx0 === tx1 && ty0 === ty1) {
      const tile = this.materializeTile(tx0, ty0);
      const tileDocX = tx0 * TILE_SIZE;
      const tileDocY = ty0 * TILE_SIZE;
      tile.ctx.save();
      tile.ctx.translate(-tileDocX, -tileDocY);
      try {
        fn(tile.ctx);
      } finally {
        tile.ctx.restore();
      }
      this.flatCache = null;
      return;
    }

    // ===== 複数タイル staging path =====
    // 影響タイル範囲をタイル境界に拡張 (staging はタイル単位の幅で持つ)
    const stagingDocX = tx0 * TILE_SIZE;
    const stagingDocY = ty0 * TILE_SIZE;
    const stagingDocXEnd = Math.min((tx1 + 1) * TILE_SIZE, this.width);
    const stagingDocYEnd = Math.min((ty1 + 1) * TILE_SIZE, this.height);
    const stagingW = stagingDocXEnd - stagingDocX;
    const stagingH = stagingDocYEnd - stagingDocY;

    const staging = createBackingCanvas(stagingW, stagingH);

    // 既存タイルの内容を staging に合成
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = this.tiles.get(tileKey(tx, ty, this.tilesX));
        if (!tile) continue;
        const dx = tx * TILE_SIZE - stagingDocX;
        const dy = ty * TILE_SIZE - stagingDocY;
        staging.ctx.drawImage(tile.canvas as CanvasImageSource, dx, dy);
      }
    }

    // fn を doc 座標で動かす: staging を doc 原点へ translate する。
    // save/restore で囲んで fn 内の状態変更を吸収。
    staging.ctx.save();
    staging.ctx.translate(-stagingDocX, -stagingDocY);
    try {
      fn(staging.ctx);
    } finally {
      staging.ctx.restore();
    }

    // staging を該当タイルへ焼き戻す。"copy" composite で tile の現状を完全に置き換える
    // (staging には既存内容も含めて反映済みなので)。
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = this.materializeTile(tx, ty);
        const sx = tx * TILE_SIZE - stagingDocX;
        const sy = ty * TILE_SIZE - stagingDocY;
        const tileW = tile.canvas.width;
        const tileH = tile.canvas.height;
        tile.ctx.save();
        tile.ctx.globalCompositeOperation = "copy";
        tile.ctx.drawImage(
          staging.canvas as CanvasImageSource,
          sx,
          sy,
          tileW,
          tileH,
          0,
          0,
          tileW,
          tileH
        );
        tile.ctx.restore();
      }
    }
    this.flatCache = null;
  }

  // ===== adopt 系 (resize / extendCanvas / materializeLayer で使う) =====

  // 別 TileStore の内容を (dx, dy) にコピーして自身を埋める。
  // 既存ピクセルとは加算 (source-over)。clearRect → adoptFromAt の組で使う前提。
  adoptFromAt(source: TileStore, dx: number, dy: number): void {
    if (source.flatBacking) {
      const flat = source.flatBacking;
      const drawFlatRect = (
        srcDocX: number,
        srcDocY: number,
        srcW: number,
        srcH: number
      ): void => {
        const destX = dx + srcDocX;
        const destY = dy + srcDocY;
        this.forEachTileInDocRect(destX, destY, srcW, srcH, (tile, _tx, _ty, inter) => {
          tile.ctx.drawImage(
            flat.canvas as CanvasImageSource,
            inter.docX - dx,
            inter.docY - dy,
            inter.tileW,
            inter.tileH,
            inter.tileX,
            inter.tileY,
            inter.tileW,
            inter.tileH
          );
        }, { materialize: true });
      };

      if (source.tiles.size === 0) {
        // source 側がフラットなら 1 枚 drawImage
        drawFlatRect(0, 0, flat.canvas.width, flat.canvas.height);
      } else {
        for (let ty = 0; ty < source.tilesY; ty += 1) {
          for (let tx = 0; tx < source.tilesX; tx += 1) {
            const srcDocX = tx * TILE_SIZE;
            const srcDocY = ty * TILE_SIZE;
            const stile = source.tiles.get(tileKey(tx, ty, source.tilesX));
            if (stile) {
              const destX = dx + srcDocX;
              const destY = dy + srcDocY;
              this.forEachTileInDocRect(destX, destY, stile.canvas.width, stile.canvas.height, (tile, _tx, _ty, inter) => {
                tile.ctx.drawImage(
                  stile.canvas as CanvasImageSource,
                  inter.docX - destX,
                  inter.docY - destY,
                  inter.tileW,
                  inter.tileH,
                  inter.tileX,
                  inter.tileY,
                  inter.tileW,
                  inter.tileH
                );
              }, { materialize: true });
              continue;
            }

            const tileW = Math.min(TILE_SIZE, source.width - srcDocX);
            const tileH = Math.min(TILE_SIZE, source.height - srcDocY);
            const srcW = Math.min(tileW, Math.max(0, flat.canvas.width - srcDocX));
            const srcH = Math.min(tileH, Math.max(0, flat.canvas.height - srcDocY));
            if (srcW <= 0 || srcH <= 0) continue;
            drawFlatRect(srcDocX, srcDocY, srcW, srcH);
          }
        }
      }
    } else {
      // source 側がタイル: タイルごとに自分側へ転写
      for (const [skey, stile] of source.tiles) {
        const stx = skey % source.tilesX;
        const sty = (skey - stx) / source.tilesX;
        const srcDocX = stx * TILE_SIZE;
        const srcDocY = sty * TILE_SIZE;
        const srcW = stile.canvas.width;
        const srcH = stile.canvas.height;
        const destX = dx + srcDocX;
        const destY = dy + srcDocY;
        this.forEachTileInDocRect(destX, destY, srcW, srcH, (tile, _tx, _ty, inter) => {
          tile.ctx.drawImage(
            stile.canvas as CanvasImageSource,
            inter.docX - destX,
            inter.docY - destY,
            inter.tileW,
            inter.tileH,
            inter.tileX,
            inter.tileY,
            inter.tileW,
            inter.tileH
          );
        }, { materialize: true });
      }
    }
    this.flatCache = null;
  }

  // source 全体を縦横スケールしてコピー。resize のリサンプリングで使う。
  // 高品質補間のため imageSmoothingQuality = high。
  adoptFromScaled(
    source: TileStore,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    dstX: number,
    dstY: number,
    dstW: number,
    dstH: number
  ): void {
    if (dstW <= 0 || dstH <= 0 || srcW <= 0 || srcH <= 0) return;
    // 補間品質を保つため source 全体を 1 枚にしてからスケール drawImage する。
    // resize は頻度が低い (アプリ操作で稀にしか起きない) ので、ここで flat を経由しても影響少。
    const sourceFlat = source.ensureFlat();
    const sx = dstW / srcW;
    const sy = dstH / srcH;
    this.forEachTileInDocRect(dstX, dstY, dstW, dstH, (tile, _tx, _ty, inter) => {
      const subSrcX = srcX + (inter.docX - dstX) / sx;
      const subSrcY = srcY + (inter.docY - dstY) / sy;
      const subSrcW = inter.tileW / sx;
      const subSrcH = inter.tileH / sy;
      tile.ctx.save();
      tile.ctx.imageSmoothingEnabled = true;
      tile.ctx.imageSmoothingQuality = "high";
      tile.ctx.drawImage(
        sourceFlat.canvas as CanvasImageSource,
        subSrcX,
        subSrcY,
        subSrcW,
        subSrcH,
        inter.tileX,
        inter.tileY,
        inter.tileW,
        inter.tileH
      );
      tile.ctx.restore();
    }, { materialize: true });
    this.flatCache = null;
  }

  // ===== 外部 I/F (PNG / HTMLCanvas スナップショット) =====

  async toPngBytes(rect?: Rect): Promise<Uint8Array> {
    const flat = rect
      ? (() => {
          const { canvas, ctx } = createBackingCanvas(rect.w, rect.h);
          this.drawTo(ctx, -rect.x, -rect.y, { x: 0, y: 0, w: rect.w, h: rect.h });
          return { canvas, ctx };
        })()
      : this.ensureFlat();
    let blob: Blob;
    if (
      typeof OffscreenCanvas !== "undefined" &&
      flat.canvas instanceof OffscreenCanvas
    ) {
      blob = await flat.canvas.convertToBlob({ type: "image/png" });
    } else {
      blob = await htmlCanvasToBlob(flat.canvas as HTMLCanvasElement, "image/png");
    }
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ag-psd が HTMLCanvas を要求するため。既に HTMLCanvas のフラット backing を
  // 持っているならそれを返す (ゼロコピー)。OffscreenCanvas のフラットだったり、
  // タイル運用に入っていたりする場合は新規 HTMLCanvas に合成する。
  toHtmlCanvasSnapshot(): HTMLCanvasElement {
    const flat = this.ensureFlat();
    if (
      typeof HTMLCanvasElement !== "undefined" &&
      flat.canvas instanceof HTMLCanvasElement
    ) {
      return flat.canvas;
    }
    const c = document.createElement("canvas");
    c.width = flat.canvas.width;
    c.height = flat.canvas.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(flat.canvas as CanvasImageSource, 0, 0);
    return c;
  }

  // ===== 内部ヘルパ =====

  // 書き込み前: flatBacking があれば hint と交差するタイルだけを tiles に切り出す。
  // hint なし、または全タイルを覆う hint では flatBacking を解放してタイル運用へ移行する。
  private beforeWrite(hint?: Rect): void {
    if (this.flatBacking) {
      const writeRect = this.clampDocRect(hint);
      if (!writeRect) {
        if (!hint) this.flatBacking = null;
      } else {
        const range = this.tileRangeForClampedRect(writeRect);
        for (let ty = range.ty0; ty <= range.ty1; ty += 1) {
          for (let tx = range.tx0; tx <= range.tx1; tx += 1) {
            this.materializeTile(tx, ty);
          }
        }
        if (this.tileRangeCoversAllTiles(range)) this.flatBacking = null;
      }
    }
    // 書き込みは flat キャッシュも無効化
    this.flatCache = null;
  }

  // 指定タイルが存在しなければ新規作成して返す。書き込み API から呼ぶ。
  private materializeTile(tx: number, ty: number): Tile {
    const key = tileKey(tx, ty, this.tilesX);
    let t = this.tiles.get(key);
    if (!t) {
      const tileDocX = tx * TILE_SIZE;
      const tileDocY = ty * TILE_SIZE;
      const tw = Math.min(TILE_SIZE, this.width - tileDocX);
      const th = Math.min(TILE_SIZE, this.height - tileDocY);
      const { canvas, ctx } = createBackingCanvas(Math.max(1, tw), Math.max(1, th));
      if (this.flatBacking) {
        const srcW = Math.min(tw, Math.max(0, this.flatBacking.canvas.width - tileDocX));
        const srcH = Math.min(th, Math.max(0, this.flatBacking.canvas.height - tileDocY));
        if (srcW > 0 && srcH > 0) {
          ctx.drawImage(
            this.flatBacking.canvas as CanvasImageSource,
            tileDocX,
            tileDocY,
            srcW,
            srcH,
            0,
            0,
            srcW,
            srcH
          );
        }
      }
      t = { canvas, ctx };
      this.tiles.set(key, t);
    }
    return t;
  }

  private clampDocRect(rect?: Rect): ClampedDocRect | null {
    const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
    const y0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
    const x1 = rect ? Math.min(this.width, Math.ceil(rect.x + rect.w)) : this.width;
    const y1 = rect ? Math.min(this.height, Math.ceil(rect.y + rect.h)) : this.height;
    if (
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      x0 >= x1 ||
      y0 >= y1
    ) {
      return null;
    }
    return { x0, y0, x1, y1 };
  }

  private tileRangeForClampedRect(rect: ClampedDocRect): TileRange {
    return {
      tx0: Math.floor(rect.x0 / TILE_SIZE),
      ty0: Math.floor(rect.y0 / TILE_SIZE),
      tx1: Math.floor((rect.x1 - 1) / TILE_SIZE),
      ty1: Math.floor((rect.y1 - 1) / TILE_SIZE),
    };
  }

  private tileRangeCoversAllTiles(range: TileRange): boolean {
    return (
      range.tx0 === 0 &&
      range.ty0 === 0 &&
      range.tx1 === this.tilesX - 1 &&
      range.ty1 === this.tilesY - 1
    );
  }

  // 指定範囲 (doc 座標) と交差する各タイルに対して fn を呼ぶ。
  // materialize:false (デフォルト) のときは「既に存在するタイル」のみ。
  // materialize:true のときは存在しないタイルも作って渡す (書き込み系で使う)。
  private forEachTileInDocRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fn: (
      tile: Tile,
      tx: number,
      ty: number,
      intersection: {
        tileX: number;
        tileY: number;
        tileW: number;
        tileH: number;
        docX: number;
        docY: number;
      }
    ) => void,
    options: { materialize?: boolean } = {}
  ): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    if (x0 >= x1 || y0 >= y1) return;
    const tx0 = Math.floor(x0 / TILE_SIZE);
    const ty0 = Math.floor(y0 / TILE_SIZE);
    const tx1 = Math.floor((x1 - 1) / TILE_SIZE);
    const ty1 = Math.floor((y1 - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        let tile = this.tiles.get(tileKey(tx, ty, this.tilesX));
        if (!tile) {
          if (!options.materialize) continue;
          tile = this.materializeTile(tx, ty);
        }
        const tileDocX = tx * TILE_SIZE;
        const tileDocY = ty * TILE_SIZE;
        const ix0 = Math.max(tileDocX, x0);
        const iy0 = Math.max(tileDocY, y0);
        const ix1 = Math.min(tileDocX + tile.canvas.width, x1);
        const iy1 = Math.min(tileDocY + tile.canvas.height, y1);
        fn(tile, tx, ty, {
          tileX: ix0 - tileDocX,
          tileY: iy0 - tileDocY,
          tileW: ix1 - ix0,
          tileH: iy1 - iy0,
          docX: ix0,
          docY: iy0,
        });
      }
    }
  }

  // flat 表現を返す。flatBacking があればそれを、なければ全タイルを合成して
  // flatCache に保存して返す。canvas/ctx ゲッタ・スナップショット用。
  // flat 経由の書き戻しを期待してはいけない (タイル化された tiles が真実)。
  private ensureFlat(): Tile {
    if (this.flatBacking && this.tiles.size === 0) return this.flatBacking;
    if (this.flatCache) return this.flatCache;
    const { canvas, ctx } = createBackingCanvas(
      Math.max(1, this.width),
      Math.max(1, this.height)
    );
    if (this.flatBacking) {
      ctx.drawImage(this.flatBacking.canvas as CanvasImageSource, 0, 0);
    }
    for (const [key, tile] of this.tiles) {
      const tx = key % this.tilesX;
      const ty = (key - tx) / this.tilesX;
      ctx.clearRect(
        tx * TILE_SIZE,
        ty * TILE_SIZE,
        tile.canvas.width,
        tile.canvas.height
      );
      ctx.drawImage(tile.canvas as CanvasImageSource, tx * TILE_SIZE, ty * TILE_SIZE);
    }
    this.flatCache = { canvas, ctx };
    return this.flatCache;
  }
}
