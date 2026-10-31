// PSD ファイル入出力。ag-psd 経由でレイヤー情報を読み書きする。
// v2 サポート範囲:
//   - レイヤー: ピクセル / 名前 / 不透明度 / visible / blendMode / left/top
//   - グループ（フォルダ）: 入れ子も再帰的に保持。グループ自身の blendMode/opacity も維持。
//   - クリッピングマスク: 直下レイヤーへのクリップ関係を双方向で保持。
//   - ドキュメント: width / height / サムネ
// 未対応: レイヤー効果 / スマートオブジェクト / 調整レイヤー / ベクターマスク

import {
  decodeLayerPixels,
  readPsd,
  writePsd,
  Psd,
  Layer as PsdLayer,
  BlendMode as PsdBlendMode,
} from "ag-psd";
import { PaintDocument, PixelLayer } from "./PaintDocument";
import { compositeLayers } from "./composite";
import { BlendMode, LayerMeta, NativeReadTiming, PsdLoadTimingReport } from "../types";
import {
  MAX_PSD_DIMENSION,
  PSD_HEADER_BYTES,
  assertPsdDocumentDimensions,
  assertPsdFileSize,
  parsePsdHeader,
  type PsdHeaderSummary,
} from "./psdPreflight";

export {
  MAX_PSD_DIMENSION,
  MAX_PSD_FILE_BYTES,
  PSD_HEADER_BYTES,
  preflightPsdOpen,
} from "./psdPreflight";

// メモリ事故防止: PSD はバイナリ仕様上、巨大なファイル/巨大な画像も作れる。
// 16384px 平方 ≈ 1GB の ImageData バッファを要するので、これを上限の目安に。
export const MAX_PSD_LAYER_COUNT = 1024;
export const MAX_PSD_DECODED_IMAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2GiB

const RGBA_CHANNEL_COUNT = 4;

function corruptPsdError(detail: string): Error {
  return new Error(`PSD ファイルが破損しているか未対応の形式です: ${detail}`);
}

async function readPsdHeader(file: Blob): Promise<PsdHeaderSummary> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.slice(0, PSD_HEADER_BYTES).arrayBuffer();
  } catch (e) {
    throw corruptPsdError(`PSD ヘッダーを読み込めませんでした: ${e instanceof Error ? e.message : e}`);
  }
  return parsePsdHeader(new Uint8Array(buffer));
}

function assertPsdMatchesHeader(psd: Psd, header: PsdHeaderSummary): void {
  if (
    psd.width !== header.width ||
    psd.height !== header.height ||
    psd.bitsPerChannel !== header.bitsPerChannel
  ) {
    throw corruptPsdError("PSD ヘッダーと解析結果が一致しません");
  }
}

function isPsdGroup(layer: PsdLayer): layer is PsdLayer & { children: PsdLayer[] } {
  // ag-psd は空フォルダも children: [] で表すため、要素数では判定しない。
  return Array.isArray(layer.children);
}

function validatePsdMetadataBeforeDecode(psd: Psd, header: PsdHeaderSummary): void {
  assertPsdMatchesHeader(psd, header);
  assertPsdDocumentDimensions(psd.width, psd.height);

  const bytesPerChannel = Math.max(1, header.bitsPerChannel / 8);
  const pending = [...(psd.children ?? [])];
  let layerCount = 0;
  let drawableLayerCount = 0;
  let decodedImageBytes = 0;
  const addDecodedRegion = (width: number, height: number, label: string): void => {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 0 ||
      height < 0
    ) {
      throw corruptPsdError(`${label}の画像範囲が不正です`);
    }
    if (width > MAX_PSD_DIMENSION || height > MAX_PSD_DIMENSION) {
      throw new Error(
        `${label}のサイズが大きすぎます (${width}x${height}, 上限 ${MAX_PSD_DIMENSION}px)`
      );
    }

    const regionBytes = width * height * RGBA_CHANNEL_COUNT * bytesPerChannel;
    decodedImageBytes += regionBytes;
    if (
      !Number.isSafeInteger(regionBytes) ||
      !Number.isSafeInteger(decodedImageBytes) ||
      decodedImageBytes > MAX_PSD_DECODED_IMAGE_BYTES
    ) {
      throw new Error(
        `PSD の画像デコード後サイズが大きすぎます (上限 ${MAX_PSD_DECODED_IMAGE_BYTES / 1024 / 1024}MB)`
      );
    }
  };

  while (pending.length > 0) {
    const layer = pending.pop()!;
    layerCount += 1;
    if (layerCount > MAX_PSD_LAYER_COUNT) {
      throw new Error(
        `PSD のレイヤー数が多すぎます (${layerCount}, 上限 ${MAX_PSD_LAYER_COUNT})`
      );
    }

    if (isPsdGroup(layer)) {
      pending.push(...layer.children);
    } else {
      drawableLayerCount += 1;

      // walkPsdChildren が decodeLayerPixels を呼ぶ対象だけを事前メモリ見積もりに含める。
      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const right = layer.right ?? left;
      const bottom = layer.bottom ?? top;
      const layerWidth = right - left;
      const layerHeight = bottom - top;
      const layerLabel = `PSD レイヤー ${layer.name || layerCount}`;
      addDecodedRegion(layerWidth, layerHeight, layerLabel);

      for (const [maskLabel, mask] of [
        ["マスク", layer.mask],
        ["実マスク", layer.realMask],
      ] as const) {
        if (!mask) continue;
        const maskLeft = mask.left ?? 0;
        const maskTop = mask.top ?? 0;
        const maskRight = mask.right ?? maskLeft;
        const maskBottom = mask.bottom ?? maskTop;
        addDecodedRegion(
          maskRight - maskLeft,
          maskBottom - maskTop,
          `${layerLabel}の${maskLabel}`
        );
      }
    }
  }

  if (drawableLayerCount === 0) {
    throw new Error(
      layerCount === 0
        ? "読み込めるレイヤーが見つかりませんでした"
        : "描画レイヤーが無く、フォルダだけの PSD は読み込めません"
    );
  }
}

// AI Paint -> PSD のブレンドモード対応表。
const BLEND_TO_PSD: Record<BlendMode, PsdBlendMode> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color dodge",
  "color-burn": "color burn",
  "linear-dodge": "linear dodge",
  subtract: "subtract",
  "soft-light": "soft light",
  difference: "difference",
  color: "color",
  luminosity: "luminosity",
};

// PSD -> AI Paint。未対応のものはすべて "normal" に落とす。
function blendFromPsd(b: PsdBlendMode | undefined): BlendMode {
  switch (b) {
    case "multiply":
      return "multiply";
    case "screen":
      return "screen";
    case "overlay":
      return "overlay";
    case "darken":
    case "darker color":
      return "darken";
    case "lighten":
    case "lighter color":
      return "lighten";
    case "color dodge":
      return "color-dodge";
    case "linear dodge":
      return "linear-dodge";
    case "color burn":
    case "linear burn":
      return "color-burn";
    case "subtract":
      return "subtract";
    case "soft light":
      return "soft-light";
    case "difference":
      return "difference";
    case "color":
      return "color";
    case "luminosity":
      return "luminosity";
    default:
      return "normal";
  }
}

// PSD レイヤーを bbox サイズの canvas に描き込み、合成時のオフセット情報を一緒に返す。
//
// 旧旧版: doc サイズの一時 canvas + fragment canvas + getImageData の往復で
//   1 レイヤーあたり doc サイズ ×3 を確保 → 高解像度 PSD では数 GB の一時確保と
//   アルファ変換ラウンドトリップが連鎖し、極端に遅くなっていた。
// 旧版: doc サイズ canvas に putImageData 1 回で済ませる → 中間メモリは減ったが、
//   依然として doc サイズ × レイヤー数のメモリを開いた瞬間に確保していた。
// 今版: bbox サイズの canvas を保持して、composite 側がオフセット込みで貼る。
//   レイヤーへ初めて書き込む直前に doc サイズ化 (materialize) する遅延戦略。
//   50 レイヤー × 8000² PSD でも、開いた直後は実際の描画 bbox の合計サイズで足りる。
//
// 返却される canvas/ctx のサイズは bbox 寸法。空レイヤー (imageData 無し) は 1x1。
function paintPsdLayerToCanvas(l: PsdLayer): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasLikeCtx;
  deferred: { offsetX: number; offsetY: number; bboxWidth: number; bboxHeight: number };
} {
  const left = typeof l.left === "number" ? l.left : 0;
  const top = typeof l.top === "number" ? l.top : 0;
  const hasPixels = !!(l.imageData && l.imageData.width > 0 && l.imageData.height > 0);
  // 空レイヤーは 1x1 (offset 0)。composite は bboxWidth/Height が 0 だとオフセット適用を
  // スキップする実装なので、最小サイズで持っておけば十分。
  const bboxW = hasPixels ? l.imageData!.width : 1;
  const bboxH = hasPixels ? l.imageData!.height : 1;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bboxW, bboxH)
      : (() => {
          const c = document.createElement("canvas");
          c.width = bboxW;
          c.height = bboxH;
          return c;
        })();
  const ctx = (canvas as HTMLCanvasElement).getContext("2d") as CanvasLikeCtx;
  if (hasPixels) {
    // ag-psd の PixelArray を ImageData が受け取れる Uint8ClampedArray<ArrayBuffer> に変換。
    // bbox サイズぴったりの 1 回コピーで完了。doc サイズ往復のコストはここで完全に消える。
    const data = new Uint8ClampedArray(l.imageData!.data as unknown as ArrayLike<number>);
    const id = new ImageData(data, bboxW, bboxH);
    ctx.putImageData(id, 0, 0);
  }
  return {
    canvas,
    ctx,
    deferred: {
      offsetX: left,
      offsetY: top,
      bboxWidth: hasPixels ? bboxW : 0,
      bboxHeight: hasPixels ? bboxH : 0,
    },
  };
}

type CanvasLikeCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// PSD の children（bottom-up）を doc.layers 用の {meta, canvas} 列にフラット化する。
// グループはレイヤーとして残し、parentId を子に伝搬する。
// doc.layers の慣例: 配列順は下から上、グループはその子より前（lower index）に置く。
// メインスレッドを長時間ブロックしないよう、概ね 16ms ごとに setTimeout で yield する
// （PSD ロード中のスピナーアニメ等を維持するため）。レイヤー枚数ベースだと巨大な
// 1 枚レイヤーをデコード中に固まるので時間ベースにしている。
const YIELD_INTERVAL_MS = 16;
interface WalkPsdState {
  nextYieldAt: number;
  layerDecodeMs: number;
  bboxCanvasMs: number;
}

async function walkPsdChildren(
  children: PsdLayer[],
  docWidth: number,
  docHeight: number,
  parentId: string | undefined,
  idPrefix: string,
  out: PsdLoadedLayer[],
  state: WalkPsdState
): Promise<void> {
  for (let idx = 0; idx < children.length; idx += 1) {
    const l = children[idx];
    const id = `${idPrefix}-${out.length}`;
    const isGroup = isPsdGroup(l);
    if (performance.now() >= state.nextYieldAt) {
      await new Promise<void>((r) => setTimeout(r, 0));
      state.nextYieldAt = performance.now() + YIELD_INTERVAL_MS;
    }
    if (isGroup) {
      const groupMeta: LayerMeta = {
        id,
        name: l.name || "フォルダ",
        visible: !l.hidden,
        opacity: typeof l.opacity === "number" ? l.opacity : 1,
        blendMode: blendFromPsd(l.blendMode),
        locked: false,
        kind: "group",
        parentId,
        // ag-psd: opened===false なら閉じている。未定義なら開きとみなす。
        collapsed: l.opened === false,
        // グループへの clipping は実用上機能しないので捨てる
      };
      // グループ自身は描画には使わない。canvas: null で PaintDocument 側が空 canvas を作る。
      out.push({ meta: groupMeta, canvas: null, ctx: null, deferred: undefined });
      await walkPsdChildren(l.children!, docWidth, docHeight, id, idPrefix, out, state);
    } else {
      // 通常レイヤー。空ピクセルでも meta は保持して読み込む。
      // 事前検証後にこのレイヤーだけをデコードし、全レイヤー分の ImageData を
      // 同時保持しない。bbox サイズで保持し、composite はオフセット込みで描画する。
      const decodeStartedAt = performance.now();
      try {
        decodeLayerPixels(l, true);
      } catch (e) {
        throw corruptPsdError(
          `レイヤー ${l.name || id} をデコードできませんでした: ${e instanceof Error ? e.message : e}`
        );
      } finally {
        state.layerDecodeMs += performance.now() - decodeStartedAt;
      }
      const bboxStartedAt = performance.now();
      try {
        const { canvas, ctx, deferred } = paintPsdLayerToCanvas(l);
        out.push({
          meta: {
            id,
            name: l.name || "レイヤー",
            visible: !l.hidden,
            opacity: typeof l.opacity === "number" ? l.opacity : 1,
            blendMode: blendFromPsd(l.blendMode),
            locked: false,
            kind: "raster",
            parentId,
            clippingMask: !!l.clipping,
          },
          canvas,
          ctx,
          deferred,
        });
      } finally {
        state.bboxCanvasMs += performance.now() - bboxStartedAt;
        l.imageData = undefined;
        if (l.mask) l.mask.imageData = undefined;
        if (l.realMask) l.realMask.imageData = undefined;
      }
    }
  }
}

interface PsdLoadedLayer {
  meta: LayerMeta;
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  ctx: CanvasLikeCtx | null;
  deferred?: { offsetX: number; offsetY: number; bboxWidth: number; bboxHeight: number };
}

function isDrawableLayer(layer: PsdLoadedLayer): boolean {
  return layer.meta.kind !== "group";
}

function hasDeferredPixels(layer: PsdLoadedLayer): boolean {
  return !layer.deferred || (layer.deferred.bboxWidth > 0 && layer.deferred.bboxHeight > 0);
}

function pickInitialActiveLayer(layers: PsdLoadedLayer[]): string {
  const topDown = [...layers].reverse();
  const preferred =
    topDown.find(
      (layer) =>
        isDrawableLayer(layer) &&
        layer.meta.visible &&
        !layer.meta.locked &&
        hasDeferredPixels(layer)
    ) ??
    topDown.find(
      (layer) => isDrawableLayer(layer) && layer.meta.visible && !layer.meta.locked
    ) ??
    topDown.find((layer) => isDrawableLayer(layer) && !layer.meta.locked) ??
    layers.find(isDrawableLayer);

  if (!preferred) throw new Error("描画レイヤーが見つかりませんでした");
  return preferred.meta.id;
}

interface LoadPsdOptions {
  fileName?: string;
  nativeReadTiming?: NativeReadTiming;
}

// PSD ファイルを読み込んで doc を上書きする。
export async function loadPsd(
  file: Blob,
  doc: PaintDocument,
  options?: LoadPsdOptions
): Promise<PsdLoadTimingReport> {
  const loadStartedAt = performance.now();
  assertPsdFileSize(file.size);

  const headerPreflightStartedAt = performance.now();
  const header = await readPsdHeader(file);
  const headerPreflightMs = performance.now() - headerPreflightStartedAt;

  const arrayBufferStartedAt = performance.now();
  const buffer = await file.arrayBuffer();
  const fileArrayBufferMs = performance.now() - arrayBufferStartedAt;

  const metadataPreflightStartedAt = performance.now();
  {
    let metadata: Psd;
    try {
      // .aipaint の manifest 先行検証と同様に、まず画像データを展開せず
      // レイヤー数・bbox・デコード後メモリ量を検証する。
      metadata = readPsd(buffer, {
        skipLayerImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
        skipLinkedFilesData: true,
      });
    } catch (e) {
      throw corruptPsdError(e instanceof Error ? e.message : String(e));
    }
    validatePsdMetadataBeforeDecode(metadata, header);
  }
  const metadataPreflightMs = performance.now() - metadataPreflightStartedAt;

  let psd: Psd;
  let readPsdMs = 0;
  try {
    // useImageData: true で半透明ピクセルの premultiplied alpha 破損を回避。
    const readPsdStartedAt = performance.now();
    psd = readPsd(buffer, {
      skipLayerImageData: false,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      useRawData: true,
    });
    readPsdMs = performance.now() - readPsdStartedAt;
  } catch (e) {
    throw corruptPsdError(e instanceof Error ? e.message : String(e));
  }

  const width = psd.width;
  const height = psd.height;
  assertPsdMatchesHeader(psd, header);
  assertPsdDocumentDimensions(width, height);

  const idPrefix = `psd-${Date.now().toString(36)}`;
  const out: PsdLoadedLayer[] = [];
  const walkStartedAt = performance.now();
  const walkState: WalkPsdState = {
    nextYieldAt: performance.now() + YIELD_INTERVAL_MS,
    layerDecodeMs: 0,
    bboxCanvasMs: 0,
  };
  if (psd.children) {
    await walkPsdChildren(psd.children, width, height, undefined, idPrefix, out, walkState);
  }
  const walkPsdChildrenMs = performance.now() - walkStartedAt;
  // 描画可能なレイヤーが 1 枚もない場合は弾く（フォルダしか無い / 完全に空）
  const hasDrawable = out.some(isDrawableLayer);
  if (!hasDrawable) {
    throw new Error(
      out.length === 0
        ? "読み込めるレイヤーが見つかりませんでした"
        : "描画レイヤーが無く、フォルダだけの PSD は読み込めません"
    );
  }

  let docResizeMs = 0;
  if (doc.width !== width || doc.height !== height) {
    const resizeStartedAt = performance.now();
    doc.resize(width, height);
    docResizeMs = performance.now() - resizeStartedAt;
  }

  // PSD ヘッダ (imageResources.resolutionInfo) の DPI を doc に反映。
  // 単位が PPCM のときは PPI に換算 (1 inch = 2.54 cm)。
  const resInfo = psd.imageResources?.resolutionInfo;
  if (resInfo && typeof resInfo.horizontalResolution === "number" && resInfo.horizontalResolution > 0) {
    const ppi =
      resInfo.horizontalResolutionUnit === "PPCM"
        ? resInfo.horizontalResolution * 2.54
        : resInfo.horizontalResolution;
    doc.setDpi(ppi);
  }

  const initialActiveLayerId = pickInitialActiveLayer(out);
  const replaceStartedAt = performance.now();
  doc.replaceLayersFromCanvas(out, initialActiveLayerId);
  const replaceLayersFromCanvasMs = performance.now() - replaceStartedAt;

  return {
    fileName: options?.fileName,
    fileBytes: file.size,
    width,
    height,
    layerCount: out.length,
    drawableLayerCount: out.filter((l) => l.meta.kind !== "group").length,
    groupLayerCount: out.filter((l) => l.meta.kind === "group").length,
    deferredLayerCount: out.filter((l) => l.deferred && l.deferred.bboxWidth > 0).length,
    nativeRead: options?.nativeReadTiming,
    timings: {
      headerPreflightMs,
      fileArrayBufferMs,
      metadataPreflightMs,
      readPsdMs,
      walkPsdChildrenMs,
      layerDecodeMs: walkState.layerDecodeMs,
      bboxCanvasMs: walkState.bboxCanvasMs,
      docResizeMs,
      replaceLayersFromCanvasMs,
      loadPsdTotalMs: performance.now() - loadStartedAt,
    },
  };
}

// doc.layers から PSD の入れ子 children ツリーを組み立てる。
// doc.layers は bottom-up、PSD の children も bottom-up。
// parentId → 子レイヤー配列の Map を 1 度だけ作って O(N) で再帰構築する。
function buildPsdChildren(doc: PaintDocument): PsdLayer[] {
  // null はトップレベルを表すキー（Map では undefined キーが扱いにくいので文字列化）
  const TOP = "";
  const byParent = new Map<string, PixelLayer[]>();
  for (const layer of doc.layers) {
    const key = layer.meta.parentId ?? TOP;
    let arr = byParent.get(key);
    if (!arr) {
      arr = [];
      byParent.set(key, arr);
    }
    arr.push(layer);
  }
  const buildLayerBase = (layer: PixelLayer): Pick<
    PsdLayer,
    "name" | "opacity" | "hidden" | "blendMode" | "clipping"
  > => ({
    name: layer.meta.name,
    opacity: layer.meta.opacity,
    hidden: !layer.meta.visible,
    blendMode: BLEND_TO_PSD[layer.meta.blendMode] ?? "normal",
    clipping: !!layer.meta.clippingMask,
  });

  const buildOne = (layer: PixelLayer): PsdLayer => {
    if (layer.meta.kind === "group") {
      const children = (byParent.get(layer.meta.id) ?? []).map(buildOne);
      return {
        name: layer.meta.name,
        opacity: layer.meta.opacity,
        hidden: !layer.meta.visible,
        blendMode: BLEND_TO_PSD[layer.meta.blendMode] ?? "normal",
        opened: !layer.meta.collapsed,
        // ag-psd 仕様: グループへの clipping 指定は実用上意味を持たないため出力しない
        children,
      };
    }
    // deferred (PSD ロード後一切編集していないレイヤー) は bbox canvas を直接 ag-psd に渡し、
    // left/top でオフセットを伝える。これで doc サイズの一時 canvas を作らずに済む
    // (重い PSD を開いて即再保存する場合のコストが大きく下がる)。
    //
    // 空 deferred (元 PSD で imageData を持っていなかったレイヤー) は 1x1 placeholder
    // canvas を持つが bboxWidth/Height は 0。この場合は通常パスに落として
    // doc サイズの空 canvas を作る方が ag-psd の取り扱いがシンプル。
    if (layer.deferred && layer.deferred.bboxWidth > 0 && layer.deferred.bboxHeight > 0) {
      const def = layer.deferred;
      const c = layer.store.toHtmlCanvasSnapshot();
      return {
        ...buildLayerBase(layer),
        canvas: c,
        left: def.offsetX,
        top: def.offsetY,
        right: def.offsetX + def.bboxWidth,
        bottom: def.offsetY + def.bboxHeight,
      };
    }
    // 通常レイヤーも bbox だけを PSD レイヤーとして渡し、doc サイズ canvas × レイヤー数の
    // 一時確保を避ける。空レイヤーは canvas を渡さず 0x0 の PSD レイヤーにする。
    const bounds = layer.store.getAlphaBounds();
    if (!bounds) {
      return buildLayerBase(layer);
    }
    const c = document.createElement("canvas");
    c.width = bounds.w;
    c.height = bounds.h;
    const cctx = c.getContext("2d")!;
    layer.store.drawTo(cctx, -bounds.x, -bounds.y, { x: 0, y: 0, w: bounds.w, h: bounds.h });
    return {
      ...buildLayerBase(layer),
      canvas: c,
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.w,
      bottom: bounds.y + bounds.h,
    };
  };
  return (byParent.get(TOP) ?? []).map(buildOne);
}

// サムネ用合成。PSD ビューアでの見た目が実画と乖離しないよう、本物の compositor を使う。
function compositeForThumbnail(doc: PaintDocument): HTMLCanvasElement {
  const composite = document.createElement("canvas");
  composite.width = doc.width;
  composite.height = doc.height;
  const ctx = composite.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, doc.width, doc.height);
  compositeLayers(ctx, doc, doc.layers, undefined);
  return composite;
}

// doc を PSD として書き出す。
export async function savePsd(doc: PaintDocument): Promise<Blob> {
  // 描画可能なレイヤー(raster/text) が 1 枚もないなら保存不可
  const hasDrawable = doc.layers.some((l: PixelLayer) => l.meta.kind !== "group");
  if (!hasDrawable) {
    throw new Error("レイヤーが空のため PSD として保存できません");
  }

  const children = buildPsdChildren(doc);
  const composite = compositeForThumbnail(doc);

  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    canvas: composite,
    children,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: doc.dpi,
        horizontalResolutionUnit: "PPI",
        widthUnit: "Inches",
        verticalResolution: doc.dpi,
        verticalResolutionUnit: "PPI",
        heightUnit: "Inches",
      },
    },
  };

  // trimImageData: 透明部分の多いレイヤー（線画/ハイライト等）を実バウンディング rect に
  // 縮めてから書き出すことで、書き出しデータ量と RLE 圧縮時間を削減する。
  const buffer = writePsd(psd, { generateThumbnail: true, trimImageData: true });
  // ArrayBufferLike を確実な ArrayBuffer 上のコピーに変換して Blob 化
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buffer));
  return new Blob([ab], { type: "image/vnd.adobe.photoshop" });
}

export function defaultPsdFilename(): string {
  return `ai-paint-${new Date().toISOString().replace(/[:.]/g, "-")}.psd`;
}
