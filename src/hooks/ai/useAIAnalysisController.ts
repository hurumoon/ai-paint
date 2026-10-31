import { useCallback } from "react";
import { ReferenceImage } from "../../components/AIPanel";
import {
  analyzeCanvas,
  chooseFocusQuadrant,
  expandGuidesToDocSize,
} from "../../core/aiClient";
import {
  buildQuadrantAnalysisContext,
  QuadrantAnalysisImage,
} from "../../core/aiAnalysisContext";
import {
  canCropSelectionForAI,
  cropSelectionToBase64ForAI,
  flattenDocumentToBase64ForAI,
} from "../../core/aiImagePayload";
import { PaintDocument } from "../../core/PaintDocument";
import { AIMode, GuideShape, Selection, WorkStage } from "../../types";
import { pushToast } from "../../ui/primitives";
import { PreviousSnapshotRef } from "./useAIImagePayloads";
import type { TabUiStatePatch } from "../useTabs";

function referenceToPayload(reference: ReferenceImage) {
  return {
    base64: reference.base64,
    mediaType: reference.mediaType,
  };
}

interface UseAIAnalysisControllerOptions {
  activeTabId: string | null;
  doc: PaintDocument | null;
  selection: Selection;
  hasApiKey: boolean;
  aiMode: AIMode;
  aiPrompt: string;
  stage: WorkStage;
  references: ReferenceImage[];
  zoomTarget: boolean;
  enhancedAIEnabled: boolean;
  previousSnapshotRef: PreviousSnapshotRef;
  setIsLoading: (value: boolean) => void;
  setLoadingTabId: (tabId: string | null) => void;
  applyTabUiStatePatch: (targetTabId: string | null, patch: TabUiStatePatch) => boolean;
}

function rectGuidesFromQuadrant(
  guides: GuideShape[],
  quadrant: QuadrantAnalysisImage
): GuideShape[] {
  const localGuides = expandGuidesToDocSize(
    guides.filter((g): g is Extract<GuideShape, { type: "rect" }> => g.type === "rect"),
    quadrant.rect.w,
    quadrant.rect.h,
    quadrant.sentWidth,
    quadrant.sentHeight
  ).filter((g): g is Extract<GuideShape, { type: "rect" }> => g.type === "rect");
  return localGuides.map((g) => ({
    ...g,
    x: quadrant.rect.x + g.x,
    y: quadrant.rect.y + g.y,
  }));
}

export function useAIAnalysisController({
  activeTabId,
  doc,
  selection,
  hasApiKey,
  aiMode,
  aiPrompt,
  stage,
  references,
  zoomTarget,
  enhancedAIEnabled,
  previousSnapshotRef,
  setIsLoading,
  setLoadingTabId,
  applyTabUiStatePatch,
}: UseAIAnalysisControllerOptions): () => Promise<void> {
  return useCallback(async () => {
    const targetTabId = activeTabId;
    if (!doc) return;
    if (!hasApiKey) {
      applyTabUiStatePatch(targetTabId, { error: "API キーを入れてください" });
      return;
    }
    setLoadingTabId(targetTabId);
    setIsLoading(true);
    applyTabUiStatePatch(targetTabId, { error: "" });
    try {
      const shouldCropSelection = zoomTarget && canCropSelectionForAI(selection);
      const selectionPayload = shouldCropSelection
        ? await cropSelectionToBase64ForAI(doc, selection)
        : null;
      const payload = selectionPayload ?? await flattenDocumentToBase64ForAI(doc);
      const selectionRect = selectionPayload?.sourceRect ?? null;
      const isZoom = selectionRect !== null;
      const nextSnapshot = isZoom
        ? await flattenDocumentToBase64ForAI(doc)
        : payload;

      if (enhancedAIEnabled && !isZoom) {
        const quadrantContext = await buildQuadrantAnalysisContext(doc);
        const quadrantId = await chooseFocusQuadrant({
          mode: aiMode,
          stage,
          userPrompt: aiPrompt,
          mainImageBase64: payload.base64,
          quadrantImagesBase64: quadrantContext.images.map((image) => image.base64),
          contextText: quadrantContext.text,
        });
        const selectedQuadrant =
          quadrantContext.images.find((image) => image.id === quadrantId) ??
          quadrantContext.images[0];
        const focusRes = await analyzeCanvas({
          mode: aiMode,
          stage,
          userPrompt: [
            aiPrompt,
            "",
            `選択された分割: ${selectedQuadrant.label}`,
            "この分割画像だけを見て、改善点を具体的に指摘してください。",
            "guides は rect のみで返してください。line と circle は使わないでください。",
            "guides の座標は、この分割画像内の 0.0〜1.0 正規化座標で返してください。",
          ].join("\n"),
          analysisContext: `選択された分割: ${selectedQuadrant.label}`,
          enhancedAnalysis: true,
          mainImageBase64: selectedQuadrant.base64,
          referenceImages: references.map(referenceToPayload),
          canvasWidth: selectedQuadrant.sentWidth,
          canvasHeight: selectedQuadrant.sentHeight,
          isZoomedSelection: true,
        });
        const quadrantGuides = rectGuidesFromQuadrant(focusRes.guides, selectedQuadrant);
        applyTabUiStatePatch(targetTabId, {
          advice: focusRes.advice,
          guides: quadrantGuides,
          ...(focusRes.palette && focusRes.palette.length > 0
            ? { palette: focusRes.palette }
            : {}),
          showGuides: true,
        });
        previousSnapshotRef.current = nextSnapshot;
        return;
      }

      const firstRes = await analyzeCanvas({
        mode: aiMode,
        stage,
        userPrompt: aiPrompt,
        analysisContext: "",
        enhancedAnalysis: false,
        mainImageBase64: payload.base64,
        referenceImages: references.map(referenceToPayload),
        canvasWidth: payload.width,
        canvasHeight: payload.height,
        isZoomedSelection: isZoom,
      });
      const docW = selectionRect ? selectionRect.w : doc.width;
      const docH = selectionRect ? selectionRect.h : doc.height;
      const expanded = expandGuidesToDocSize(
        firstRes.guides,
        docW,
        docH,
        payload.width,
        payload.height
      );

      let nextGuides: GuideShape[];
      if (selectionRect) {
        const ox = selectionRect.x;
        const oy = selectionRect.y;
        nextGuides =
          expanded.map((g) => {
            if (g.type === "line")
              return { ...g, x1: g.x1 + ox, y1: g.y1 + oy, x2: g.x2 + ox, y2: g.y2 + oy };
            if (g.type === "circle") return { ...g, cx: g.cx + ox, cy: g.cy + oy };
            return { ...g, x: g.x + ox, y: g.y + oy };
          });
      } else {
        nextGuides = expanded;
      }
      applyTabUiStatePatch(targetTabId, {
        advice: firstRes.advice,
        guides: nextGuides,
        ...(firstRes.palette && firstRes.palette.length > 0
          ? { palette: firstRes.palette }
          : {}),
        showGuides: true,
      });
      previousSnapshotRef.current = nextSnapshot;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applyTabUiStatePatch(targetTabId, { error: `エラー: ${msg}` });
      pushToast(`AI解析に失敗: ${msg}`, "error");
    } finally {
      setIsLoading(false);
      setLoadingTabId(null);
    }
  }, [
    aiMode,
    aiPrompt,
    activeTabId,
    applyTabUiStatePatch,
    doc,
    hasApiKey,
    enhancedAIEnabled,
    previousSnapshotRef,
    references,
    selection,
    setIsLoading,
    setLoadingTabId,
    stage,
    zoomTarget,
  ]);
}
