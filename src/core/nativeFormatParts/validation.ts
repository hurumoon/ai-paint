import type { BlendMode, LayerKind, TextLayerData } from "../../types";
import {
  BLEND_MODES,
  BYTES_PER_PIXEL,
  LAYER_KINDS,
  MAGIC_V1,
  MAGIC_V2,
  MAX_AIPAINT_DECODED_RGBA_BYTES,
  MAX_AIPAINT_DIMENSION,
  MAX_AIPAINT_DPI,
  MAX_AIPAINT_GROUP_DEPTH,
  MAX_AIPAINT_LAYER_COUNT,
  MAX_AIPAINT_LAYER_PNG_BYTES,
  MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL,
  MAX_AIPAINT_MANIFEST_BYTES,
  MAX_AIPAINT_TEXT_LENGTH,
  MAX_AIPAINT_ZIP_FILE_BYTES,
  V1_LAYER_FILE_RE,
  V2_LAYER_FILE_RE,
} from "./constants";
import { fail, formatMegabytes } from "./errors";
import { assertPngHeader } from "./png";
import type {
  BoundsV2,
  ManifestImageLayerV2,
  ManifestLayerV1,
  ManifestLayerV2,
  ManifestV1,
  ManifestV2,
} from "./types";

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && BLEND_MODES.has(value as BlendMode);
}

function isLayerKind(value: unknown): value is LayerKind {
  return typeof value === "string" && LAYER_KINDS.has(value as LayerKind);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") fail(`${label} が不正です`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(`${label} が不正です`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} が不正です`);
  }
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value)) fail(`${label} が不正です`);
}

function assertTextLayerData(
  value: unknown,
  index: number
): asserts value is TextLayerData {
  if (!isRecord(value)) fail(`テキストレイヤー ${index + 1} の情報が不正です`);
  assertString(value.text, `テキストレイヤー ${index + 1} の本文`);
  if (value.text.length > MAX_AIPAINT_TEXT_LENGTH) {
    fail(`テキストレイヤー ${index + 1} の本文が長すぎます`);
  }
  assertString(value.fontFamily, `テキストレイヤー ${index + 1} のフォント`);
  assertFiniteNumber(value.fontSize, `テキストレイヤー ${index + 1} のフォントサイズ`);
  if (value.fontSize <= 0) {
    fail(`テキストレイヤー ${index + 1} のフォントサイズが不正です`);
  }
  assertString(value.color, `テキストレイヤー ${index + 1} の色`);
  assertBoolean(value.bold, `テキストレイヤー ${index + 1} の太字設定`);
  assertBoolean(value.italic, `テキストレイヤー ${index + 1} の斜体設定`);
  if (value.align !== "left" && value.align !== "center" && value.align !== "right") {
    fail(`テキストレイヤー ${index + 1} の配置が不正です`);
  }
  for (const key of ["x", "y", "lineHeight"] as const) {
    assertFiniteNumber(value[key], `テキストレイヤー ${index + 1} の${key}`);
  }
  if (
    value.maxWidth !== undefined &&
    (typeof value.maxWidth !== "number" ||
      !Number.isFinite(value.maxWidth) ||
      value.maxWidth <= 0)
  ) {
    fail(`テキストレイヤー ${index + 1} の最大幅が不正です`);
  }
}

function assertDocumentMeta(manifest: Record<string, unknown>, version: 1 | 2): {
  width: number;
  height: number;
  dpi: number;
  activeLayerId: string;
  rawLayers: unknown[];
} {
  if (manifest.version !== version) {
    throw new Error(`未対応の .aipaint バージョンです: ${String(manifest.version)}`);
  }
  assertInteger(manifest.width, ".aipaint の幅");
  assertInteger(manifest.height, ".aipaint の高さ");
  const width = manifest.width;
  const height = manifest.height;
  if (width <= 0 || height <= 0) throw new Error(".aipaint のサイズが不正です");
  if (width > MAX_AIPAINT_DIMENSION || height > MAX_AIPAINT_DIMENSION) {
    throw new Error(
      `.aipaint のサイズが大きすぎます (${width}x${height}, 上限 ${MAX_AIPAINT_DIMENSION}px)`
    );
  }
  assertInteger(manifest.dpi, ".aipaint のDPI");
  const dpi = manifest.dpi;
  if (dpi <= 0 || dpi > MAX_AIPAINT_DPI) fail(".aipaint のDPIが不正です");
  assertString(manifest.activeLayerId, "アクティブレイヤーID");
  const rawLayers = manifest.layers;
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new Error("レイヤーが空です");
  }
  if (rawLayers.length > MAX_AIPAINT_LAYER_COUNT) {
    fail(`レイヤー数が多すぎます (${rawLayers.length}, 上限 ${MAX_AIPAINT_LAYER_COUNT})`);
  }
  return { width, height, dpi, activeLayerId: manifest.activeLayerId, rawLayers };
}

function validateLayerGraph(
  layers: { id: string; kind: LayerKind; parentId?: string }[],
  activeLayerId: string
): void {
  const byId = new Map<string, { id: string; kind: LayerKind; parentId?: string }>();
  for (const layer of layers) {
    if (byId.has(layer.id)) fail(`レイヤーIDが重複しています: ${layer.id}`);
    byId.set(layer.id, layer);
  }
  if (!byId.has(activeLayerId)) fail("アクティブレイヤーIDが存在しません");

  for (const layer of layers) {
    if (!layer.parentId) continue;
    const parent = byId.get(layer.parentId);
    if (!parent || parent.kind !== "group") {
      fail(`レイヤー ${layer.id} の親IDが不正です`);
    }
  }

  for (const layer of layers) {
    let depth = 0;
    let cur: string | undefined = layer.parentId;
    const seen = new Set<string>([layer.id]);
    while (cur) {
      if (seen.has(cur)) fail("レイヤーの親子関係が循環しています");
      seen.add(cur);
      depth += 1;
      if (depth > MAX_AIPAINT_GROUP_DEPTH) {
        fail(`グループ階層が深すぎます (上限 ${MAX_AIPAINT_GROUP_DEPTH})`);
      }
      cur = byId.get(cur)?.parentId;
    }
  }
}

function normalizeV1Layer(layer: unknown, index: number): ManifestLayerV1 {
  if (!isRecord(layer)) fail(`レイヤー ${index + 1} の情報が不正です`);
  assertString(layer.id, `レイヤー ${index + 1} のID`);
  if (layer.id.length === 0) fail(`レイヤー ${index + 1} のIDが空です`);
  assertString(layer.name, `レイヤー ${index + 1} の名前`);
  assertBoolean(layer.visible, `レイヤー ${index + 1} の表示状態`);
  assertFiniteNumber(layer.opacity, `レイヤー ${index + 1} の不透明度`);
  if (layer.opacity < 0 || layer.opacity > 1) {
    fail(`レイヤー ${index + 1} の不透明度が不正です`);
  }
  if (!isBlendMode(layer.blendMode)) {
    fail(`レイヤー ${index + 1} のブレンドモードが不正です`);
  }
  assertBoolean(layer.locked, `レイヤー ${index + 1} のロック状態`);
  const kind = layer.kind === undefined ? "raster" : layer.kind;
  if (!isLayerKind(kind)) fail(`レイヤー ${index + 1} の種類が不正です`);
  let text: TextLayerData | undefined;
  if (kind === "text") {
    assertTextLayerData(layer.text, index);
    text = layer.text;
  }
  if (kind !== "text" && hasOwn(layer, "text")) {
    fail(`レイヤー ${index + 1} のテキスト情報が不正です`);
  }
  let parentId: string | undefined;
  if (layer.parentId !== undefined) {
    assertString(layer.parentId, `レイヤー ${index + 1} の親ID`);
    parentId = layer.parentId;
  }
  let collapsed: boolean | undefined;
  if (layer.collapsed !== undefined) {
    assertBoolean(layer.collapsed, `レイヤー ${index + 1} の開閉状態`);
    collapsed = layer.collapsed;
  }
  let clippingMask: boolean | undefined;
  if (layer.clippingMask !== undefined) {
    assertBoolean(layer.clippingMask, `レイヤー ${index + 1} のクリッピング状態`);
    clippingMask = layer.clippingMask;
  }
  let transparentPixelLock: boolean | undefined;
  if (layer.transparentPixelLock !== undefined) {
    assertBoolean(
      layer.transparentPixelLock,
      `レイヤー ${index + 1} の透明ピクセルロック状態`
    );
    transparentPixelLock = layer.transparentPixelLock;
  }
  let file = "";
  if (kind !== "group") {
    assertString(layer.file, `レイヤー ${index + 1} のファイル名`);
    if (!V1_LAYER_FILE_RE.test(layer.file) || layer.file.includes("..")) {
      fail(`レイヤー ${index + 1} のファイル名が不正です`);
    }
    file = layer.file;
  } else if (typeof layer.file === "string") {
    file = layer.file;
  }
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    transparentPixelLock,
    kind,
    text,
    parentId,
    collapsed,
    clippingMask,
    file,
  };
}

export function assertManifestV1(manifest: unknown): ManifestV1 {
  if (!isRecord(manifest)) throw new Error("manifest.json が不正です");
  if (manifest.magic !== MAGIC_V1) {
    throw new Error(`未対応のファイル形式: ${String(manifest.magic)}`);
  }
  const meta = assertDocumentMeta(manifest, 1);
  const layers = meta.rawLayers.map(normalizeV1Layer);
  validateLayerGraph(layers, meta.activeLayerId);
  const drawableCount = layers.filter((layer) => layer.kind !== "group").length;
  if (drawableCount === 0) fail("描画レイヤーがありません");
  const decodedBytes = meta.width * meta.height * BYTES_PER_PIXEL * drawableCount;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_AIPAINT_DECODED_RGBA_BYTES) {
    fail(
      `.aipaint のRGBAデコード後サイズが大きすぎます (${formatMegabytes(decodedBytes)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_DECODED_RGBA_BYTES)}MB)`
    );
  }
  return {
    magic: MAGIC_V1,
    version: 1,
    width: meta.width,
    height: meta.height,
    dpi: meta.dpi,
    activeLayerId: meta.activeLayerId,
    layers,
  };
}

function assertBoundsV2(
  bounds: unknown,
  index: number,
  docWidth: number,
  docHeight: number
): BoundsV2 {
  if (!isRecord(bounds)) fail(`レイヤー ${index + 1} のboundsが不正です`);
  const x = bounds.x;
  const y = bounds.y;
  const width = bounds.width;
  const height = bounds.height;
  assertInteger(x, `レイヤー ${index + 1} のbounds.x`);
  assertInteger(y, `レイヤー ${index + 1} のbounds.y`);
  assertInteger(width, `レイヤー ${index + 1} のbounds.width`);
  assertInteger(height, `レイヤー ${index + 1} のbounds.height`);
  const out = { x, y, width, height };
  if (out.width <= 0 || out.height <= 0 || out.x < 0 || out.y < 0) {
    fail(`レイヤー ${index + 1} のboundsが不正です`);
  }
  if (out.x + out.width > docWidth || out.y + out.height > docHeight) {
    fail(`レイヤー ${index + 1} のboundsがキャンバス外です`);
  }
  return out;
}

function normalizeV2Layer(
  layer: unknown,
  index: number,
  docWidth: number,
  docHeight: number
): ManifestLayerV2 {
  if (!isRecord(layer)) fail(`レイヤー ${index + 1} の情報が不正です`);
  assertString(layer.id, `レイヤー ${index + 1} のID`);
  if (layer.id.length === 0) fail(`レイヤー ${index + 1} のIDが空です`);
  assertString(layer.name, `レイヤー ${index + 1} の名前`);
  assertBoolean(layer.visible, `レイヤー ${index + 1} の表示状態`);
  assertFiniteNumber(layer.opacity, `レイヤー ${index + 1} の不透明度`);
  if (layer.opacity < 0 || layer.opacity > 1) {
    fail(`レイヤー ${index + 1} の不透明度が不正です`);
  }
  if (!isBlendMode(layer.blendMode)) {
    fail(`レイヤー ${index + 1} のブレンドモードが不正です`);
  }
  assertBoolean(layer.locked, `レイヤー ${index + 1} のロック状態`);
  if (!isLayerKind(layer.kind)) fail(`レイヤー ${index + 1} の種類が不正です`);

  let parentId: string | undefined;
  if (layer.parentId !== undefined) {
    assertString(layer.parentId, `レイヤー ${index + 1} の親ID`);
    parentId = layer.parentId;
  }
  let collapsed: boolean | undefined;
  if (layer.collapsed !== undefined) {
    assertBoolean(layer.collapsed, `レイヤー ${index + 1} の開閉状態`);
    collapsed = layer.collapsed;
  }
  let clippingMask: boolean | undefined;
  if (layer.clippingMask !== undefined) {
    assertBoolean(layer.clippingMask, `レイヤー ${index + 1} のクリッピング状態`);
    clippingMask = layer.clippingMask;
  }
  let transparentPixelLock: boolean | undefined;
  if (layer.transparentPixelLock !== undefined) {
    assertBoolean(
      layer.transparentPixelLock,
      `レイヤー ${index + 1} の透明ピクセルロック状態`
    );
    transparentPixelLock = layer.transparentPixelLock;
  }

  const base = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    transparentPixelLock,
    parentId,
    collapsed,
    clippingMask,
  };

  if (layer.kind === "group") {
    if (hasOwn(layer, "file") || hasOwn(layer, "bounds") || hasOwn(layer, "empty")) {
      fail(`グループ ${index + 1} に画像情報は指定できません`);
    }
    if (hasOwn(layer, "text")) fail(`グループ ${index + 1} のテキスト情報が不正です`);
    return { ...base, kind: "group" };
  }

  if (layer.kind !== "text" && hasOwn(layer, "text")) {
    fail(`レイヤー ${index + 1} のテキスト情報が不正です`);
  }
  let text: TextLayerData | undefined;
  if (layer.kind === "text") {
    assertTextLayerData(layer.text, index);
    text = layer.text;
  }
  if (layer.empty !== undefined) assertBoolean(layer.empty, `レイヤー ${index + 1} のempty`);
  if (layer.empty === true) {
    if (hasOwn(layer, "file") || hasOwn(layer, "bounds")) {
      fail(`空レイヤー ${index + 1} に画像情報は指定できません`);
    }
    return { ...base, kind: layer.kind, text, empty: true };
  }

  assertString(layer.file, `レイヤー ${index + 1} のファイル名`);
  if (!V2_LAYER_FILE_RE.test(layer.file)) {
    fail(`レイヤー ${index + 1} のファイル名が不正です`);
  }
  const bounds = assertBoundsV2(layer.bounds, index, docWidth, docHeight);
  return { ...base, kind: layer.kind, text, empty: false, file: layer.file, bounds };
}

export function assertManifestV2(manifest: unknown): ManifestV2 {
  if (!isRecord(manifest)) throw new Error("manifest.json が不正です");
  if (manifest.magic !== MAGIC_V2) {
    throw new Error(`未対応のファイル形式: ${String(manifest.magic)}`);
  }
  const meta = assertDocumentMeta(manifest, 2);
  if (manifest.agent !== undefined && (
    !isRecord(manifest.agent) || manifest.agent.version !== 1 ||
    manifest.agent.file !== "agent/session.json"
  )) fail("未対応または不正なAIドロー（β版） の記録形式です");
  const layers = meta.rawLayers.map((layer, index) =>
    normalizeV2Layer(layer, index, meta.width, meta.height)
  );
  validateLayerGraph(layers, meta.activeLayerId);

  const files = new Set<string>();
  let decodedRgbaBytes = 0;
  let drawableCount = 0;
  for (const layer of layers) {
    if (layer.kind === "group") continue;
    drawableCount += 1;
    if (layer.empty === true) continue;
    if (!layer.file || !layer.bounds) fail(`レイヤー ${layer.id} の画像情報が不正です`);
    if (files.has(layer.file)) fail(`レイヤーファイルが重複しています: ${layer.file}`);
    files.add(layer.file);
    decodedRgbaBytes += layer.bounds.width * layer.bounds.height * BYTES_PER_PIXEL;
  }
  if (drawableCount === 0) fail("描画レイヤーがありません");
  if (
    !Number.isSafeInteger(decodedRgbaBytes) ||
    decodedRgbaBytes > MAX_AIPAINT_DECODED_RGBA_BYTES
  ) {
    fail(
      `.aipaint のRGBAデコード後サイズが大きすぎます (${formatMegabytes(decodedRgbaBytes)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_DECODED_RGBA_BYTES)}MB)`
    );
  }

  return {
    magic: MAGIC_V2,
    version: 2,
    ...(manifest.agent === undefined ? {} : { agent: { version: 1 as const, file: "agent/session.json" as const } }),
    width: meta.width,
    height: meta.height,
    dpi: meta.dpi,
    activeLayerId: meta.activeLayerId,
    layers,
  };
}

function referencedV2Layers(manifest: ManifestV2): ManifestImageLayerV2[] {
  return manifest.layers.filter(
    (layer): layer is ManifestImageLayerV2 =>
      layer.kind !== "group" && layer.empty !== true
  );
}

export function validateSavedV2Manifest(
  manifest: ManifestV2,
  manifestBytes: Uint8Array
): ManifestV2 {
  if (manifestBytes.byteLength > MAX_AIPAINT_MANIFEST_BYTES) {
    fail(`manifest.json が大きすぎます (${formatMegabytes(manifestBytes.byteLength)}MB)`);
  }
  return assertManifestV2(manifest);
}

// 転送後のPNGを保持せずに済むよう、生成直後に検証して累計だけを引き継ぐ。
export function validateSavedV2LayerPng(
  layer: ManifestImageLayerV2,
  pngBytes: Uint8Array,
  previousPngBytesTotal: number
): number {
  if (!layer.file || !layer.bounds) fail(`レイヤー ${layer.id} の画像情報が不正です`);
  if (pngBytes.byteLength > MAX_AIPAINT_LAYER_PNG_BYTES) {
    fail(
      `レイヤーファイルが大きすぎます (${layer.file}, ${formatMegabytes(pngBytes.byteLength)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_BYTES)}MB)`
    );
  }
  const layerPngBytesTotal = previousPngBytesTotal + pngBytes.byteLength;
  if (layerPngBytesTotal > MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL) {
    fail(
      `.aipaint の参照PNG合計サイズが大きすぎます (${formatMegabytes(layerPngBytesTotal)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL)}MB)`
    );
  }
  assertPngHeader(pngBytes, layer.bounds.width, layer.bounds.height, layer.file);
  return layerPngBytesTotal;
}

export function validateSavedV2Parts(
  manifest: ManifestV2,
  files: Record<string, Uint8Array>,
  manifestBytes: Uint8Array
): void {
  const normalizedManifest = validateSavedV2Manifest(manifest, manifestBytes);
  let layerPngBytesTotal = 0;
  for (const layer of referencedV2Layers(normalizedManifest)) {
    if (!layer.file || !layer.bounds) fail(`レイヤー ${layer.id} の画像情報が不正です`);
    const pngBytes = files[layer.file];
    if (!pngBytes) fail(`レイヤーファイルが見つかりません: ${layer.file}`);
    layerPngBytesTotal = validateSavedV2LayerPng(layer, pngBytes, layerPngBytesTotal);
  }
}

export function validateSavedV2ArchiveSize(zippedBytes: number): void {
  if (zippedBytes > MAX_AIPAINT_ZIP_FILE_BYTES) {
    fail(
      `.aipaint ファイルが大きすぎます (${formatMegabytes(zippedBytes)}MB, 上限 ${MAX_AIPAINT_ZIP_FILE_BYTES / 1024 / 1024}MB)`
    );
  }
}

export function validateSavedV2Archive(
  manifest: ManifestV2,
  files: Record<string, Uint8Array>,
  manifestBytes: Uint8Array,
  zippedBytes: number
): void {
  validateSavedV2Parts(manifest, files, manifestBytes);
  validateSavedV2ArchiveSize(zippedBytes);
}
