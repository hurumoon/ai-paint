import { strToU8 } from "fflate";
import { createAiPaintArchiveWriter } from "../../workers/aiPaintSaveClient";
import { exportDrawingAgentSession } from "../agent/session";
import { PaintDocument } from "../PaintDocument";
import { normalizeLayerOrder } from "../layerTree";
import type { LayerMeta } from "../../types";
import { MAGIC_V2 } from "./constants";
import type {
  BoundsV2,
  ManifestImageLayerV2,
  ManifestLayerBaseV2,
  ManifestV2,
} from "./types";
import { createThumbnailPng } from "./thumbnail";
import {
  validateSavedV2LayerPng,
  validateSavedV2Manifest,
} from "./validation";

export { computeThumbnailSize } from "./thumbnail";

function v2BaseLayer(layer: { meta: LayerMeta }): ManifestLayerBaseV2 {
  return {
    id: layer.meta.id,
    name: layer.meta.name,
    visible: layer.meta.visible,
    opacity: layer.meta.opacity,
    blendMode: layer.meta.blendMode,
    locked: layer.meta.locked,
    transparentPixelLock: !!layer.meta.transparentPixelLock,
    kind: layer.meta.kind ?? "raster",
    parentId: layer.meta.parentId,
    collapsed: layer.meta.collapsed,
    clippingMask: layer.meta.clippingMask,
  };
}

export async function saveAiPaint(doc: PaintDocument): Promise<Blob> {
  const manifest: ManifestV2 = {
    magic: MAGIC_V2,
    version: 2,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    activeLayerId: doc.activeLayerId,
    layers: [],
  };
  const archive = createAiPaintArchiveWriter();
  try {
    // 作業状態も保存開始時点で固定する。後続の更新は通常の dirty 判定に残る。
    const agentSession = exportDrawingAgentSession(doc);
    if (agentSession !== undefined) {
      manifest.agent = { version: 1, file: "agent/session.json" };
      await archive.add(manifest.agent.file, strToU8(agentSession));
    }
    let fileIndex = 0;
    let layerPngBytesTotal = 0;

    for (const layer of normalizeLayerOrder(doc.layers)) {
      const base = v2BaseLayer(layer);
      if (base.kind === "group") {
        manifest.layers.push({ ...base, kind: "group" });
        continue;
      }

      const imageLayer: ManifestImageLayerV2 = {
        ...base,
        kind: base.kind === "text" ? "text" : "raster",
      };
      if (imageLayer.kind === "text") {
        if (!layer.meta.text) throw new Error("テキストレイヤーの情報がありません");
        imageLayer.text = layer.meta.text;
      }

      const deferred = layer.deferred;
      let bounds: BoundsV2 | null = null;
      let pngBytes: Uint8Array | null = null;
      if (deferred) {
        if (deferred.bboxWidth > 0 && deferred.bboxHeight > 0) {
          const docX0 = Math.max(0, deferred.offsetX);
          const docY0 = Math.max(0, deferred.offsetY);
          const docX1 = Math.min(doc.width, deferred.offsetX + deferred.bboxWidth);
          const docY1 = Math.min(doc.height, deferred.offsetY + deferred.bboxHeight);
          const clippedW = docX1 - docX0;
          const clippedH = docY1 - docY0;
          if (clippedW > 0 && clippedH > 0) {
            bounds = {
              x: docX0,
              y: docY0,
              width: clippedW,
              height: clippedH,
            };
            pngBytes = await layer.store.toPngBytes({
              x: docX0 - deferred.offsetX,
              y: docY0 - deferred.offsetY,
              w: clippedW,
              h: clippedH,
            });
          }
        }
      } else {
        const alphaBounds = layer.store.getAlphaBounds();
        if (alphaBounds) {
          bounds = {
            x: alphaBounds.x,
            y: alphaBounds.y,
            width: alphaBounds.w,
            height: alphaBounds.h,
          };
          pngBytes = await layer.store.toPngBytes(alphaBounds);
        }
      }

      if (!bounds || !pngBytes) {
        manifest.layers.push({ ...imageLayer, empty: true });
        continue;
      }

      fileIndex += 1;
      const file = `layers/layer-${fileIndex.toString().padStart(6, "0")}.png`;
      const savedLayer = { ...imageLayer, empty: false, file, bounds };
      layerPngBytesTotal = validateSavedV2LayerPng(savedLayer, pngBytes, layerPngBytesTotal);
      // Workerの処理完了を待ってから次のPNGを生成し、保存用の全レイヤー配列を作らない。
      await archive.add(file, pngBytes);
      manifest.layers.push(savedLayer);
    }

    let thumbnail: Uint8Array | undefined;
    try {
      thumbnail = await createThumbnailPng(doc);
    } catch {
      // サムネは任意。
    }
    if (thumbnail) await archive.add("thumbnail.png", thumbnail);

    const manifestBytes = strToU8(JSON.stringify(manifest));
    validateSavedV2Manifest(manifest, manifestBytes);
    await archive.add("manifest.json", manifestBytes);
    return await archive.finish();
  } finally {
    archive.dispose();
  }
}
