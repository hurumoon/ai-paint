import { useCallback, useEffect, useRef, useState } from "react";
import { History } from "../../core/History";
import { PaintDocument } from "../../core/PaintDocument";
import {
  applyAdjustment,
  blendWithMask,
  buildSelectionMaskAlpha,
  ColorAdjustment,
  luminanceHistogram,
} from "../../core/colorAdjust";
import { selectionBBox } from "../../core/toolHandlers";
import { applyTransparentPixelLock } from "../../core/transparentPixelLock";
import { pushToast } from "../../ui/primitives";
import { Selection } from "../../types";

type ColorAdjustQuickFilter = "invert" | "grayscale" | "sepia";

interface UseColorAdjustPreviewOptions {
  open: boolean;
  onClose: () => void;
  doc: PaintDocument;
  history: History;
  selection: Selection;
  buildAdjustment: () => ColorAdjustment | null;
  resetParams: () => void;
}

interface ColorAdjustSession {
  layerId: string;
  region: { x: number; y: number; w: number; h: number };
  original: ImageData;
  mask: Uint8Array | null;
}

export function useColorAdjustPreview({
  open,
  onClose,
  doc,
  history,
  selection,
  buildAdjustment,
  resetParams,
}: UseColorAdjustPreviewOptions) {
  const sessionRef = useRef<ColorAdjustSession | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const [histogram, setHistogram] = useState<Uint32Array | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    resetParams();
    setOpenError(null);

    const layer = doc.getActiveLayer();
    if (!layer) {
      setOpenError("対象レイヤーがありません");
      sessionRef.current = null;
      return;
    }
    if (layer.meta.kind === "group") {
      setOpenError("グループには適用できません");
      sessionRef.current = null;
      return;
    }
    if (layer.meta.locked) {
      setOpenError("レイヤーがロックされています");
      sessionRef.current = null;
      return;
    }
    if (!layer.meta.visible) {
      setOpenError("レイヤーが非表示です");
      sessionRef.current = null;
      return;
    }

    doc.materializeLayer(layer);

    const region = selectionBBox(selection, doc.width, doc.height);
    if (region.w <= 0 || region.h <= 0) {
      setOpenError("適用領域が空です");
      sessionRef.current = null;
      return;
    }

    const original = layer.store.getImageData(
      region.x,
      region.y,
      region.w,
      region.h
    );
    const mask = buildSelectionMaskAlpha(
      selection,
      region,
      doc.width,
      doc.height
    );
    sessionRef.current = {
      layerId: layer.meta.id,
      region,
      original,
      mask,
    };
    setHistogram(luminanceHistogram(original));
  }, [open, doc, selection, resetParams]);

  const renderPreview = useCallback(() => {
    pendingFrameRef.current = null;
    const session = sessionRef.current;
    if (!session) return;
    const layer = doc.getLayer(session.layerId);
    if (!layer) return;
    const adj = buildAdjustment();
    const { region, original, mask } = session;
    if (!adj) {
      layer.store.putImageData(original, region.x, region.y);
      doc.invalidateActive();
      return;
    }
    const transformed = applyAdjustment(original, adj);
    blendWithMask(original, transformed, mask);
    if (layer.meta.transparentPixelLock) {
      applyTransparentPixelLock(original, transformed);
    }
    layer.store.putImageData(transformed, region.x, region.y);
    doc.invalidateActive();
  }, [doc, buildAdjustment]);

  useEffect(() => {
    if (!open) return;
    if (!sessionRef.current) return;
    if (pendingFrameRef.current != null) {
      cancelAnimationFrame(pendingFrameRef.current);
    }
    pendingFrameRef.current = requestAnimationFrame(renderPreview);
    return () => {
      if (pendingFrameRef.current != null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    };
  }, [open, renderPreview]);

  const commitAdjustment = useCallback((session: ColorAdjustSession, transformed: ImageData, label: string) => {
    const layer = doc.getLayer(session.layerId);
    if (!layer) return;
    const { region, original } = session;
    const text = layer.meta.kind === "text" ? layer.meta.text : undefined;
    const rasterizeText = layer.meta.kind === "text";
    layer.store.putImageData(original, region.x, region.y);
    if (rasterizeText) {
      history.beginStructureOperation(doc, { pixelLayerIds: [session.layerId], pixelRegion: region });
    } else {
      history.beginOperation(doc, [session.layerId], { trackRegion: true, initialRegion: region });
    }
    try {
      layer.store.putImageData(transformed, region.x, region.y);
      if (rasterizeText) {
        // 部分選択の補正も保持するため、確定時だけ現在の画素を正本とする画像レイヤーへ変換する。
        // メタと画素を同じ履歴に収め、Undo では編集可能な文字ごと復元する。
        doc.updateLayerMeta(session.layerId, { kind: "raster", text: undefined });
        history.commitStructureOperation(doc, label);
      } else {
        history.commitOperation(doc, label, [session.layerId]);
      }
    } catch (error) {
      layer.store.putImageData(original, region.x, region.y);
      if (rasterizeText) doc.updateLayerMeta(session.layerId, { kind: "text", text });
      history.cancelOperation();
      doc.invalidateActive();
      throw error;
    }
  }, [doc, history]);

  const applyQuickFilter = useCallback(
    (kind: ColorAdjustQuickFilter, label: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const layer = doc.getLayer(session.layerId);
      if (!layer) return;
      const { region, original, mask } = session;
      const transformed = applyAdjustment(original, { kind });
      blendWithMask(original, transformed, mask);
      if (layer.meta.transparentPixelLock) {
        applyTransparentPixelLock(original, transformed);
      }

      commitAdjustment(session, transformed, label);

      const newOriginal = layer.store.getImageData(
        region.x,
        region.y,
        region.w,
        region.h
      );
      sessionRef.current = {
        ...session,
        original: newOriginal,
      };
      setHistogram(luminanceHistogram(newOriginal));
      resetParams();
      doc.invalidateActive();
      pushToast(`${label}を適用`, "success");
    },
    [commitAdjustment, doc, resetParams]
  );

  const handleApply = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      onClose();
      return;
    }
    const layer = doc.getLayer(session.layerId);
    if (!layer) {
      onClose();
      return;
    }
    const adj = buildAdjustment();
    if (!adj) {
      // リセット直後の適用では、元画素を戻す RAF より先にダイアログが閉じることがある。
      if (pendingFrameRef.current != null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      layer.store.putImageData(session.original, session.region.x, session.region.y);
      doc.invalidateActive();
      sessionRef.current = null;
      onClose();
      return;
    }

    if (pendingFrameRef.current != null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
      renderPreview();
    }
    const { region, original } = session;
    const transformed = layer.store.getImageData(
      region.x,
      region.y,
      region.w,
      region.h
    );
    if (layer.meta.transparentPixelLock) {
      applyTransparentPixelLock(original, transformed);
    }

    commitAdjustment(session, transformed, "色調補正");
    doc.invalidateActive();
    sessionRef.current = null;
    onClose();
  }, [commitAdjustment, doc, buildAdjustment, renderPreview, onClose]);

  const handleCancel = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      const layer = doc.getLayer(session.layerId);
      if (layer) {
        layer.store.putImageData(
          session.original,
          session.region.x,
          session.region.y
        );
        doc.invalidateActive();
      }
    }
    sessionRef.current = null;
    onClose();
  }, [doc, onClose]);

  return {
    histogram,
    openError,
    rasterizesText: sessionRef.current !== null && doc.getLayer(sessionRef.current.layerId)?.meta.kind === "text",
    applyQuickFilter,
    handleApply,
    handleCancel,
  };
}
