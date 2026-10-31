/// <reference lib="webworker" />

import { AiPaintFileError } from "../core/nativeFormatParts/errors";
import { createAiPaintArchiveBuilder } from "../core/nativeFormatParts/saveArchive";
import type {
  AiPaintSaveWorkerRequest,
  AiPaintSaveWorkerResponse,
} from "./aipaintSaveWorkerTypes";

let finished = false;
const archive = createAiPaintArchiveBuilder();

function addEntry(name: string, bytes: ArrayBuffer): void {
  if (finished) throw new Error(".aipaint の保存はすでに完了しています");
  archive.add(name, new Uint8Array(bytes));
}

function responseError(id: number, error: unknown): AiPaintSaveWorkerResponse {
  return {
    type: "error",
    id,
    name: error instanceof AiPaintFileError ? "AiPaintFileError" : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

self.onmessage = (event: MessageEvent<AiPaintSaveWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "add") {
      addEntry(request.name, request.bytes);
      const response: AiPaintSaveWorkerResponse = { type: "added", id: request.id };
      self.postMessage(response);
      return;
    }

    if (finished) throw new Error(".aipaint の保存はすでに完了しています");
    finished = true;
    const blob = archive.finish();
    const response: AiPaintSaveWorkerResponse = { type: "success", id: request.id, blob };
    self.postMessage(response);
  } catch (error) {
    finished = true;
    archive.dispose();
    self.postMessage(responseError(request.id, error));
  }
};
