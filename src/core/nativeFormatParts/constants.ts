import type { BlendMode, LayerKind } from "../../types";

export const MAGIC_V1 = "aipaint-v1";
export const MAGIC_V2 = "aipaint-v2";

export const MAX_AIPAINT_ZIP_FILE_BYTES = 500 * 1024 * 1024; // 500MiB
export const MAX_AIPAINT_FILE_BYTES = MAX_AIPAINT_ZIP_FILE_BYTES;
export const MAX_AIPAINT_MANIFEST_BYTES = 2 * 1024 * 1024; // 2MiB
export const MAX_AIPAINT_LAYER_PNG_BYTES = 128 * 1024 * 1024; // 128MiB
export const MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL =
  MAX_AIPAINT_ZIP_FILE_BYTES;
export const MAX_AIPAINT_TOTAL_ENTRY_BYTES =
  MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL;
export const MAX_AIPAINT_DECODED_RGBA_BYTES = 2 * 1024 * 1024 * 1024; // 2GiB
export const MAX_AIPAINT_DIMENSION = 16384;
export const MAX_AIPAINT_LAYER_COUNT = 1024;
export const MAX_AIPAINT_GROUP_DEPTH = 64;

export const MAX_AIPAINT_DPI = 2400;
export const MAX_AIPAINT_TEXT_LENGTH = 200_000;
export const BYTES_PER_PIXEL = 4;
export const V1_LAYER_FILE_RE = /^[A-Za-z0-9._-]+\.png$/i;
export const V2_LAYER_FILE_RE = /^layers\/layer-[0-9]{6}\.png$/;

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_COLOR_TYPE_DEPTHS = new Map<number, Set<number>>([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);

export const BLEND_MODES = new Set<BlendMode>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "linear-dodge",
  "subtract",
  "soft-light",
  "difference",
  "color",
  "luminosity",
]);

export const LAYER_KINDS = new Set<LayerKind>(["raster", "text", "group"]);
