import { PaintDocument } from "../PaintDocument";
import { setDrawingAgentSession } from "../agent/session";
import { markSessionLoaded } from "../agent/documentSessionRevision";
import type { LayerMeta } from "../../types";
import { MAX_AIPAINT_ZIP_FILE_BYTES, MAGIC_V1 } from "./constants";
import { fail, formatMegabytes } from "./errors";
import type {
  LoadedLayer,
  ManifestLayerV1,
  ManifestLayerV2,
  ManifestV1,
  ManifestV2,
} from "./types";
import { decodePngToCanvas } from "./png";
import type { PreparedAiPaintArchive } from "./prepareLoad";
import { loadAiPaintArchiveWorker } from "../../workers/aiPaintLoadClient";

function metaFromLayer(layer: ManifestLayerV1 | ManifestLayerV2): LayerMeta {
  const meta: LayerMeta = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    transparentPixelLock: !!layer.transparentPixelLock,
    kind: layer.kind,
    parentId: layer.parentId,
    collapsed: layer.collapsed,
    clippingMask: layer.clippingMask,
  };
  if (layer.kind === "text" && "text" in layer) meta.text = layer.text;
  return meta;
}

function applyLoadedLayers(
  doc: PaintDocument,
  width: number,
  height: number,
  dpi: number,
  layers: LoadedLayer[],
  activeLayerId: string
): void {
  if (doc.width !== width || doc.height !== height) doc.resize(width, height);
  doc.setDpi(dpi);
  doc.replaceLayersFromCanvas(layers, activeLayerId);
}

async function loadAiPaintV1(
  manifest: ManifestV1,
  entries: Record<string, Uint8Array>,
  doc: PaintDocument
): Promise<void> {
  const loadedLayers: LoadedLayer[] = [];
  for (const layer of manifest.layers) {
    const meta = metaFromLayer(layer);
    if (layer.kind === "group") {
      loadedLayers.push({ meta, canvas: null, ctx: null });
      continue;
    }
    const path = `layers/${layer.file}`;
    const decoded = await decodePngToCanvas(
      entries[path],
      path,
      manifest.width,
      manifest.height
    );
    loadedLayers.push({ meta, ...decoded });
  }
  applyLoadedLayers(doc, manifest.width, manifest.height, manifest.dpi, loadedLayers, manifest.activeLayerId);
}

async function loadAiPaintV2(
  manifest: ManifestV2,
  entries: Record<string, Uint8Array>,
  doc: PaintDocument
): Promise<void> {
  const loadedLayers: LoadedLayer[] = [];
  for (const layer of manifest.layers) {
    const meta = metaFromLayer(layer);
    if (layer.kind === "group" || layer.empty === true) {
      loadedLayers.push({ meta, canvas: null, ctx: null });
      continue;
    }
    if (!layer.file || !layer.bounds) fail(`レイヤー ${layer.id} の画像情報が不正です`);
    const decoded = await decodePngToCanvas(
      entries[layer.file],
      layer.file,
      layer.bounds.width,
      layer.bounds.height
    );
    loadedLayers.push({
      meta,
      ...decoded,
      deferred: {
        offsetX: layer.bounds.x,
        offsetY: layer.bounds.y,
        bboxWidth: layer.bounds.width,
        bboxHeight: layer.bounds.height,
      },
    });
  }
  applyLoadedLayers(doc, manifest.width, manifest.height, manifest.dpi, loadedLayers, manifest.activeLayerId);
}

export async function loadAiPaint(file: Blob, doc: PaintDocument): Promise<void> {
  if (file.size > MAX_AIPAINT_ZIP_FILE_BYTES) {
    throw new Error(
      `.aipaint ファイルが大きすぎます (${formatMegabytes(file.size)}MB, 上限 ${MAX_AIPAINT_ZIP_FILE_BYTES / 1024 / 1024}MB)`
    );
  }

  const archive: PreparedAiPaintArchive = await loadAiPaintArchiveWorker(file);
  if (archive.manifest.magic === MAGIC_V1) {
    await loadAiPaintV1(archive.manifest, archive.entries, doc);
    setDrawingAgentSession(doc, undefined);
    markSessionLoaded(doc);
    return;
  }
  if (archive.manifest.magic === "aipaint-v2") {
    await loadAiPaintV2(archive.manifest, archive.entries, doc);
    setDrawingAgentSession(doc, archive.agentSession);
    markSessionLoaded(doc);
    return;
  }
  throw new Error(`未対応のファイル形式: ${String((archive.manifest as { magic: unknown }).magic)}`);
}
