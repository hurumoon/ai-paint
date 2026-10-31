/// <reference lib="webworker" />

import { prepareAiPaintArchive } from "../core/nativeFormatParts/prepareLoad";
import { AiPaintFileError } from "../core/nativeFormatParts/errors";
import type { AiPaintLoadWorkerResponse } from "./aipaintLoadWorkerTypes";

self.onmessage = async (event: MessageEvent<{ file: Blob }>) => {
  try {
    const archive = await prepareAiPaintArchive(event.data.file);
    // エントリの所有権をメインへ渡す。重複バッファは transfer list に入れない。
    const transfer = [...new Set(Object.values(archive.entries).map((entry) => entry.buffer as ArrayBuffer))];
    const response: AiPaintLoadWorkerResponse = { type: "success", archive };
    (self as unknown as Worker).postMessage(response, transfer);
  } catch (error) {
    const response: AiPaintLoadWorkerResponse = {
      type: "error",
      name: error instanceof AiPaintFileError ? "AiPaintFileError" : "Error",
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
