// .aipaint ファイル形式（独自レイヤー保持形式）
//
// v1: doc 全体サイズ PNG × レイヤー。読み込み互換のみ維持。
// v2: bbox PNG × レイヤー。AI Paint の正本形式として新規保存の既定にする。

export {
  MAX_AIPAINT_DECODED_RGBA_BYTES,
  MAX_AIPAINT_DIMENSION,
  MAX_AIPAINT_DPI,
  MAX_AIPAINT_FILE_BYTES,
  MAX_AIPAINT_GROUP_DEPTH,
  MAX_AIPAINT_LAYER_COUNT,
  MAX_AIPAINT_LAYER_PNG_BYTES,
  MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL,
  MAX_AIPAINT_MANIFEST_BYTES,
  MAX_AIPAINT_TOTAL_ENTRY_BYTES,
  MAX_AIPAINT_ZIP_FILE_BYTES,
} from "./nativeFormatParts/constants";
export { loadAiPaint } from "./nativeFormatParts/load";
export { saveAiPaint } from "./nativeFormatParts/save";

export function defaultAiPaintFilename(): string {
  return `ai-paint-${new Date().toISOString().replace(/[:.]/g, "-")}.aipaint`;
}
