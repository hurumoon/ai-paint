import { readAgentSessionEntry } from "./agentArchive";
import { readManifest, readRequiredLayerEntries } from "./archive";
import { MAX_AIPAINT_ZIP_FILE_BYTES, MAGIC_V1, MAGIC_V2 } from "./constants";
import { formatMegabytes } from "./errors";
import type { ManifestV1, ManifestV2 } from "./types";
import { assertManifestV1, assertManifestV2, isRecord } from "./validation";

export interface PreparedAiPaintArchive {
  manifest: ManifestV1 | ManifestV2;
  entries: Record<string, Uint8Array>;
  agentSession?: ReturnType<typeof readAgentSessionEntry>;
}

function requiredPathsForManifest(manifest: ManifestV1 | ManifestV2): Set<string> {
  const requiredPaths = new Set<string>();
  if (manifest.magic === MAGIC_V1) {
    for (const layer of manifest.layers) {
      if (layer.kind !== "group") requiredPaths.add(`layers/${layer.file}`);
    }
  } else {
    for (const layer of manifest.layers) {
      if (layer.kind !== "group" && layer.empty !== true && layer.file) requiredPaths.add(layer.file);
    }
  }
  return requiredPaths;
}

/**
 * ZIP展開と、その結果だけで完結する検証を行う。Canvas化とドキュメント変更は呼び出し側に残す。
 */
export async function prepareAiPaintArchive(file: Blob): Promise<PreparedAiPaintArchive> {
  if (file.size > MAX_AIPAINT_ZIP_FILE_BYTES) {
    throw new Error(
      `.aipaint ファイルが大きすぎます (${formatMegabytes(file.size)}MB, 上限 ${MAX_AIPAINT_ZIP_FILE_BYTES / 1024 / 1024}MB)`
    );
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const rawManifest = readManifest(buf);
  if (!isRecord(rawManifest)) throw new Error("manifest.json が不正です");

  if (rawManifest.magic === MAGIC_V1) {
    const manifest = assertManifestV1(rawManifest);
    return { manifest, entries: readRequiredLayerEntries(buf, requiredPathsForManifest(manifest)) };
  }
  if (rawManifest.magic === MAGIC_V2) {
    const manifest = assertManifestV2(rawManifest);
    // ピクセルを置き換える前に記録を検証し、破損ファイルで部分復元しない。
    const agentSession = manifest.agent ? readAgentSessionEntry(buf) : undefined;
    return {
      manifest,
      entries: readRequiredLayerEntries(buf, requiredPathsForManifest(manifest)),
      agentSession,
    };
  }
  throw new Error(`未対応のファイル形式: ${String(rawManifest.magic)}`);
}
