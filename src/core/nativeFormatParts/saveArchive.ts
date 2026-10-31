import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { validateSavedV2ArchiveSize } from "./validation";

const ENTRY_CHUNK_BYTES = 1024 * 1024;

export interface AiPaintArchiveBuilder {
  add(name: string, bytes: Uint8Array): void;
  finish(): Blob;
  dispose(): void;
}

// zipSync のような最終バッファを作らず、fflate の出力をただちに Blob part に移す。
export function createAiPaintArchiveBuilder(): AiPaintArchiveBuilder {
  let archiveParts: Blob[] = [];
  let archiveBytes = 0;
  let finished = false;
  let disposed = false;
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    const nextSize = archiveBytes + chunk.byteLength;
    // 超過したチャンクは Blob part として保持しない。
    validateSavedV2ArchiveSize(nextSize);
    archiveBytes = nextSize;
    archiveParts.push(new Blob([chunk]));
  });

  const add = (name: string, bytes: Uint8Array): void => {
    if (finished || disposed) throw new Error(".aipaint の保存はすでに完了しています");
    const entry = name.endsWith(".png")
      ? new ZipPassThrough(name)
      : new ZipDeflate(name, { level: 1 });
    archive.add(entry);
    if (bytes.byteLength === 0) {
      entry.push(bytes, true);
      return;
    }
    for (let offset = 0; offset < bytes.byteLength; offset += ENTRY_CHUNK_BYTES) {
      const end = Math.min(offset + ENTRY_CHUNK_BYTES, bytes.byteLength);
      entry.push(bytes.subarray(offset, end), end === bytes.byteLength);
    }
  };

  return {
    add,
    finish() {
      if (finished || disposed) throw new Error(".aipaint の保存はすでに完了しています");
      finished = true;
      try {
        archive.end();
        const blob = new Blob(archiveParts, { type: "application/x-aipaint" });
        archiveParts = [];
        return blob;
      } catch (error) {
        archive.terminate();
        archiveParts = [];
        disposed = true;
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      archive.terminate();
      archiveParts = [];
    },
  };
}
