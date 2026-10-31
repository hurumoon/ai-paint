import { strFromU8, unzipSync } from "fflate";
import {
  MAX_AIPAINT_LAYER_PNG_BYTES,
  MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL,
  MAX_AIPAINT_MANIFEST_BYTES,
} from "./constants";
import { AiPaintFileError, fail, formatMegabytes } from "./errors";

function unzipAiPaintEntries(
  buf: Uint8Array,
  filter: (file: {
    name: string;
    size: number;
    originalSize: number;
    compression: number;
  }) => boolean
): Record<string, Uint8Array> {
  try {
    return unzipSync(buf, { filter });
  } catch (e) {
    if (e instanceof AiPaintFileError) throw e;
    throw new Error(
      `.aipaint ファイルが破損しているか未対応の形式です: ${e instanceof Error ? e.message : e}`
    );
  }
}

export function readManifest(buf: Uint8Array): unknown {
  const manifestEntries = unzipAiPaintEntries(buf, (entry) => {
    if (entry.name !== "manifest.json") return false;
    if (entry.originalSize > MAX_AIPAINT_MANIFEST_BYTES) {
      fail(`manifest.json が大きすぎます (${formatMegabytes(entry.originalSize)}MB)`);
    }
    return true;
  });
  const manifestBytes = manifestEntries["manifest.json"];
  if (!manifestBytes) throw new Error("manifest.json が見つかりません");
  if (manifestBytes.byteLength > MAX_AIPAINT_MANIFEST_BYTES) {
    fail(`manifest.json が大きすぎます (${formatMegabytes(manifestBytes.byteLength)}MB)`);
  }
  try {
    return JSON.parse(strFromU8(manifestBytes));
  } catch (e) {
    throw new Error(
      `manifest.json が不正です: ${e instanceof Error ? e.message : e}`
    );
  }
}

export function readRequiredLayerEntries(
  buf: Uint8Array,
  requiredPaths: Set<string>
): Record<string, Uint8Array> {
  let totalUncompressed = 0;
  const entries = unzipAiPaintEntries(buf, (entry) => {
    if (!requiredPaths.has(entry.name)) return false;
    if (entry.originalSize > MAX_AIPAINT_LAYER_PNG_BYTES) {
      fail(
        `レイヤーファイルが大きすぎます (${entry.name}, ${formatMegabytes(entry.originalSize)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_BYTES)}MB)`
      );
    }
    totalUncompressed += entry.originalSize;
    if (totalUncompressed > MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL) {
      fail(
        `.aipaint の参照PNG合計サイズが大きすぎます (${formatMegabytes(totalUncompressed)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL)}MB)`
      );
    }
    return true;
  });

  let actualTotal = 0;
  for (const path of requiredPaths) {
    const entry = entries[path];
    if (!entry) fail(`レイヤーファイルが見つかりません: ${path}`);
    if (entry.byteLength > MAX_AIPAINT_LAYER_PNG_BYTES) {
      fail(
        `レイヤーファイルが大きすぎます (${path}, ${formatMegabytes(entry.byteLength)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_BYTES)}MB)`
      );
    }
    actualTotal += entry.byteLength;
    if (actualTotal > MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL) {
      fail(
        `.aipaint の参照PNG合計サイズが大きすぎます (${formatMegabytes(actualTotal)}MB, 上限 ${formatMegabytes(MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL)}MB)`
      );
    }
  }
  return entries;
}
