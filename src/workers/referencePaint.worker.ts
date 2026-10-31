/// <reference lib="webworker" />
import { buildAdaptiveReferencePaintPlan } from "../core/referencePainting/adaptive";
import { validateReferenceSize } from "../core/referencePainting/plan";

self.onmessage = (event: MessageEvent<{ width: number; height: number; buffer: ArrayBuffer }>) => {
  try {
    const { width, height, buffer } = event.data;
    validateReferenceSize(width, height, buffer.byteLength);
    const plan = buildAdaptiveReferencePaintPlan(
      new ImageData(new Uint8ClampedArray(buffer), width, height),
      progress => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "complete", plan });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "描画手順の作成に失敗しました" });
  }
};
