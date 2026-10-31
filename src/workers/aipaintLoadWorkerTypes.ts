import type { PreparedAiPaintArchive } from "../core/nativeFormatParts/prepareLoad";

export type AiPaintLoadWorkerResponse =
  | { type: "success"; archive: PreparedAiPaintArchive }
  | { type: "error"; name: string; message: string };
