import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIImagePayload } from "../../src/core/aiImagePayload";
import type { PaintDocument } from "../../src/core/PaintDocument";
import type { Selection } from "../../src/types";
import { useAIAnalysisController } from "../../src/hooks/ai/useAIAnalysisController";
import type { PreviousSnapshotRef } from "../../src/hooks/ai/useAIImagePayloads";

const analyzeCanvasMock = vi.hoisted(() => vi.fn());
const flattenDocumentToBase64ForAIMock = vi.hoisted(() => vi.fn());
const pushToastMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/core/aiClient", () => ({
  analyzeCanvas: analyzeCanvasMock,
  chooseFocusQuadrant: vi.fn(),
  expandGuidesToDocSize: vi.fn((guides) => guides),
}));

vi.mock("../../src/core/aiImagePayload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/aiImagePayload")>()),
  flattenDocumentToBase64ForAI: flattenDocumentToBase64ForAIMock,
}));

vi.mock("../../src/ui/primitives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ui/primitives")>()),
  pushToast: pushToastMock,
}));

interface HarnessProps {
  onReady: (handleAnalyze: () => Promise<void>) => void;
  options: Parameters<typeof useAIAnalysisController>[0];
}

function Harness({ onReady, options }: HarnessProps) {
  onReady(useAIAnalysisController(options));
  return null;
}

function renderController(
  options: Parameters<typeof useAIAnalysisController>[0]
): () => Promise<void> {
  let handleAnalyze: (() => Promise<void>) | null = null;
  renderToString(
    createElement(Harness, {
      onReady: (nextHandleAnalyze) => {
        handleAnalyze = nextHandleAnalyze;
      },
      options,
    })
  );
  if (!handleAnalyze) throw new Error("AI analysis controller was not rendered");
  return handleAnalyze;
}

function createOptions(overrides: Partial<Parameters<typeof useAIAnalysisController>[0]> = {}) {
  const payload: AIImagePayload = {
    base64: "snapshot",
    width: 100,
    height: 80,
    scale: 1,
  };
  const previousSnapshotRef: PreviousSnapshotRef = { current: null };
  const doc = {
    width: 100,
    height: 80,
  } as unknown as PaintDocument;
  flattenDocumentToBase64ForAIMock.mockResolvedValue(payload);
  const options: Parameters<typeof useAIAnalysisController>[0] = {
    activeTabId: "tab-1",
    doc,
    selection: { kind: "none" } satisfies Selection,
    hasApiKey: true,
    aiMode: "composition",
    aiPrompt: "",
    stage: "rough",
    references: [],
    zoomTarget: false,
    enhancedAIEnabled: false,
    previousSnapshotRef,
    setIsLoading: vi.fn(),
    setLoadingTabId: vi.fn(),
    applyTabUiStatePatch: vi.fn(() => true),
    ...overrides,
  };
  return { options, payload, previousSnapshotRef };
}

describe("useAIAnalysisController", () => {
  beforeEach(() => {
    analyzeCanvasMock.mockReset();
    flattenDocumentToBase64ForAIMock.mockReset();
    pushToastMock.mockReset();
  });

  it("does not mark a snapshot as analyzed when AI analysis fails", async () => {
    const { options, previousSnapshotRef } = createOptions();
    analyzeCanvasMock.mockRejectedValueOnce(new Error("timeout"));

    await renderController(options)();

    expect(previousSnapshotRef.current).toBeNull();
    expect(options.applyTabUiStatePatch).toHaveBeenCalledWith("tab-1", {
      error: "エラー: timeout",
    });
    expect(pushToastMock).toHaveBeenCalledWith("AI解析に失敗: timeout", "error");
  });

  it("updates the comparison snapshot after applying successful analysis results", async () => {
    const { options, payload, previousSnapshotRef } = createOptions();
    analyzeCanvasMock.mockResolvedValueOnce({
      advice: "構図を確認",
      guides: [],
    });
    vi.mocked(options.applyTabUiStatePatch).mockImplementation((_tabId, patch) => {
      if ("advice" in patch) expect(previousSnapshotRef.current).toBeNull();
      return true;
    });

    await renderController(options)();

    expect(previousSnapshotRef.current).toBe(payload);
    expect(options.applyTabUiStatePatch).toHaveBeenCalledWith(
      "tab-1",
      expect.objectContaining({
        advice: "構図を確認",
        guides: [],
        showGuides: true,
      })
    );
  });
});
