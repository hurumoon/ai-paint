import { useCallback } from "react";
import { compareCanvas, expandGuidesToDocSize } from "../../core/aiClient";
import {
  canCompareAIImagePayloads,
  flattenDocumentToBase64ForAI,
} from "../../core/aiImagePayload";
import { PaintDocument } from "../../core/PaintDocument";
import { pushToast } from "../../ui/primitives";
import { PreviousSnapshotRef } from "./useAIImagePayloads";
import type { TabUiStatePatch } from "../useTabs";

interface UseAIComparisonControllerOptions {
  activeTabId: string | null;
  doc: PaintDocument | null;
  hasApiKey: boolean;
  previousSnapshotRef: PreviousSnapshotRef;
  setIsLoading: (value: boolean) => void;
  setLoadingTabId: (tabId: string | null) => void;
  applyTabUiStatePatch: (targetTabId: string | null, patch: TabUiStatePatch) => boolean;
}

export function useAIComparisonController({
  activeTabId,
  doc,
  hasApiKey,
  previousSnapshotRef,
  setIsLoading,
  setLoadingTabId,
  applyTabUiStatePatch,
}: UseAIComparisonControllerOptions): () => Promise<void> {
  return useCallback(async () => {
    const targetTabId = activeTabId;
    if (!doc) return;
    if (!hasApiKey) {
      applyTabUiStatePatch(targetTabId, { error: "API キーを入れてください" });
      return;
    }
    const previousPayload = previousSnapshotRef.current;
    if (!previousPayload) {
      pushToast("先に1回 AI 解析してから比較を呼んでください", "info");
      return;
    }
    setLoadingTabId(targetTabId);
    setIsLoading(true);
    applyTabUiStatePatch(targetTabId, { error: "" });
    try {
      const currentPayload = await flattenDocumentToBase64ForAI(doc);
      if (!canCompareAIImagePayloads(previousPayload, currentPayload)) {
        const msg =
          "前回解析時と AI 送信用画像の寸法または縮尺が変わったため比較できません。現在の画像を次回比較の基準に更新しました。";
        previousSnapshotRef.current = currentPayload;
        applyTabUiStatePatch(targetTabId, { error: msg });
        pushToast(msg, "info");
        return;
      }
      const res = await compareCanvas({
        previousBase64: previousPayload.base64,
        currentBase64: currentPayload.base64,
        canvasWidth: currentPayload.width,
        canvasHeight: currentPayload.height,
      });
      applyTabUiStatePatch(targetTabId, {
        advice: res.advice,
        guides: expandGuidesToDocSize(
          res.guides,
          doc.width,
          doc.height,
          currentPayload.width,
          currentPayload.height
        ),
        showGuides: true,
      });
      previousSnapshotRef.current = currentPayload;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applyTabUiStatePatch(targetTabId, { error: `比較失敗: ${msg}` });
      pushToast(`比較失敗: ${msg}`, "error");
    } finally {
      setIsLoading(false);
      setLoadingTabId(null);
    }
  }, [
    activeTabId,
    applyTabUiStatePatch,
    doc,
    hasApiKey,
    previousSnapshotRef,
    setIsLoading,
    setLoadingTabId,
  ]);
}
