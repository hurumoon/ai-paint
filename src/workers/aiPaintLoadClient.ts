import type { PreparedAiPaintArchive } from "../core/nativeFormatParts/prepareLoad";
import { AiPaintFileError } from "../core/nativeFormatParts/errors";
import AiPaintLoadWorker from "./aipaintLoad.worker?worker";
import type { AiPaintLoadWorkerResponse } from "./aipaintLoadWorkerTypes";

export function loadAiPaintArchiveWorker(file: Blob): Promise<PreparedAiPaintArchive> {
  return new Promise((resolve, reject) => {
    const worker = new AiPaintLoadWorker();
    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<AiPaintLoadWorkerResponse>) => {
      const response = event.data;
      cleanup();
      if (response.type === "success") {
        resolve(response.archive);
      } else if (response.name === "AiPaintFileError") {
        reject(new AiPaintFileError(response.message));
      } else {
        reject(new Error(response.message));
      }
    };
    worker.onerror = (event) => fail(new Error(event.message || ".aipaint の展開に失敗しました"));
    worker.onmessageerror = () => fail(new Error(".aipaint の展開結果を受け取れませんでした"));
    try {
      worker.postMessage({ file });
    } catch (error) {
      fail(error);
    }
  });
}
