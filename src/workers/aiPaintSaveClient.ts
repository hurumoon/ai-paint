import { AiPaintFileError } from "../core/nativeFormatParts/errors";
import AiPaintSaveWorker from "./aipaintSave.worker?worker";
import type {
  AiPaintSaveWorkerRequest,
  AiPaintSaveWorkerResponse,
} from "./aipaintSaveWorkerTypes";

export interface AiPaintArchiveWriter {
  // bytes の専用 ArrayBuffer を Worker へ転送する。呼び出し後は bytes を使えない。
  // 現在の保存シリアライザは各レイヤーで新規に生成した PNG バイト列を渡す。
  add(name: string, bytes: Uint8Array): Promise<void>;
  finish(): Promise<Blob>;
  dispose(): void;
}

type WorkerSuccess = Extract<AiPaintSaveWorkerResponse, { type: "added" | "success" }>;

function responseError(response: Extract<AiPaintSaveWorkerResponse, { type: "error" }>): Error {
  return response.name === "AiPaintFileError"
    ? new AiPaintFileError(response.message)
    : new Error(response.message);
}

export function createAiPaintArchiveWriter(): AiPaintArchiveWriter {
  const worker = new AiPaintSaveWorker();
  let state: "active" | "finishing" | "finished" | "disposed" | "failed" = "active";
  let nextId = 1;
  let pending: {
    id: number;
    resolve: (response: WorkerSuccess) => void;
    reject: (error: Error) => void;
  } | null = null;
  let queue: Promise<void> = Promise.resolve();

  const cleanup = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  const failPending = (error: Error) => {
    state = state === "disposed" ? "disposed" : "failed";
    const current = pending;
    pending = null;
    cleanup();
    current?.reject(error);
  };

  worker.onmessage = (event: MessageEvent<AiPaintSaveWorkerResponse>) => {
    const response = event.data;
    const current = pending;
    if (!current || current.id !== response.id) return;
    if (response.type === "error") {
      failPending(responseError(response));
      return;
    }
    pending = null;
    if (response.type === "success") state = "finished";
    current.resolve(response);
    if (response.type === "success") cleanup();
  };
  worker.onerror = (event) => {
    failPending(new Error(event.message || ".aipaint の保存に失敗しました"));
  };
  worker.onmessageerror = () => {
    failPending(new Error(".aipaint の保存結果を受け取れませんでした"));
  };

  const send = (request: AiPaintSaveWorkerRequest, transfer: Transferable[] = []) =>
    new Promise<WorkerSuccess>((resolve, reject) => {
      if (state === "disposed") {
        reject(new Error(".aipaint の保存は破棄されています"));
        return;
      }
      if (state === "failed") {
        reject(new Error(".aipaint の保存に失敗しています"));
        return;
      }
      pending = { id: request.id, resolve, reject };
      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        failPending(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    add(name, bytes) {
      if (state !== "active") {
        return Promise.reject(new Error(".aipaint の保存にはこれ以上ファイルを追加できません"));
      }
      const buffer = bytes.buffer;
      if (!(buffer instanceof ArrayBuffer) || bytes.byteOffset !== 0 || bytes.byteLength !== buffer.byteLength) {
        return Promise.reject(new Error(".aipaint の保存用バイト列は専用の ArrayBuffer である必要があります"));
      }
      const id = nextId++;
      return enqueue(async () => {
        if (state === "disposed" || state === "failed") {
          throw new Error(".aipaint の保存にはこれ以上ファイルを追加できません");
        }
        await send({ type: "add", id, name, bytes: buffer }, [buffer]);
      });
    },
    finish() {
      if (state !== "active") {
        return Promise.reject(new Error(".aipaint の保存はすでに完了または破棄されています"));
      }
      state = "finishing";
      const id = nextId++;
      return enqueue(async () => {
        const response = await send({ type: "finish", id });
        if (response.type !== "success") throw new Error(".aipaint の保存結果が不正です");
        return response.blob;
      });
    },
    dispose() {
      if (state === "disposed" || state === "finished" || state === "failed") return;
      state = "disposed";
      failPending(new Error(".aipaint の保存を中止しました"));
    },
  };
}
