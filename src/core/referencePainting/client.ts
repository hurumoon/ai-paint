import ReferencePaintWorker from "../../workers/referencePaint.worker?worker";
import type { ReferencePaintPlan, ReferencePaintProgress } from "./types";
import { validateReferenceSize } from "./plan";

export function createReferencePaintPlan(image: ImageData, options: {
  signal?: AbortSignal;
  onProgress?: (progress: ReferencePaintProgress) => void;
} = {}): Promise<ReferencePaintPlan> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException("中止しました", "AbortError")); return; }
    validateReferenceSize(image.width, image.height, image.data.byteLength);
    const worker = new ReferencePaintWorker();
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("中止しました", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "描画手順の作成に失敗しました")); };
    worker.onmessage = (event: MessageEvent<
      { type: "progress"; progress: ReferencePaintProgress } |
      { type: "complete"; plan: ReferencePaintPlan } |
      { type: "error"; message: string }
    >) => {
      if (event.data.type === "progress") options.onProgress?.(event.data.progress);
      else {
        cleanup();
        if (event.data.type === "error") reject(new Error(event.data.message));
        else resolve(event.data.plan);
      }
    };
    const buffer = image.data.slice().buffer;
    try { worker.postMessage({ width: image.width, height: image.height, buffer }, [buffer]); }
    catch (error) { cleanup(); reject(error); }
  });
}
