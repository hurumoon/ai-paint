export type AiPaintSaveWorkerRequest =
  | { type: "add"; id: number; name: string; bytes: ArrayBuffer }
  | { type: "finish"; id: number };

export type AiPaintSaveWorkerResponse =
  | { type: "added"; id: number }
  | { type: "success"; id: number; blob: Blob }
  | { type: "error"; id: number; name: string; message: string };
