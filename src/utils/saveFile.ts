// Tauri 環境ではネイティブの「名前を付けて保存」ダイアログを使い、
// 純ブラウザ環境では従来通り <a download> でフォールバックする。

import { invoke } from "@tauri-apps/api/core";
import type { NativeReadTiming } from "../types";

export interface SaveFileFilter {
  name: string;
  extensions: string[];
}

export interface SaveResult {
  cancelled: boolean;
  // 実際に書き出されたフルパス（Tauri のみ）。ブラウザでは undefined。
  path?: string;
  // 表示用のファイル名。Tauri ではユーザーが選んだ名前、ブラウザでは提示した名前。
  fileName?: string;
}

export interface OpenResult {
  cancelled: boolean;
  file?: File;
  // Tauri ネイティブダイアログ経由で開いた場合のみ得られるフルパス。
  // これがあれば Ctrl+S で同じパスに上書き保存できる。
  path?: string;
  nativeReadTiming?: NativeReadTiming;
}

interface NativeBeginOpenResult {
  cancelled: boolean;
  file_name?: string | null;
  path?: string | null;
  read_id?: string | null;
  file_size?: number | null;
  header_bytes?: number[] | Uint8Array | null;
}

interface NativeSaveResult {
  cancelled: boolean;
  file_name?: string | null;
  path?: string | null;
}

interface NativeBeginSaveResult extends NativeSaveResult {
  write_id?: string | null;
}

interface NativeBeginWriteResult {
  write_id: string;
}

interface OpenFileFromUserPathOptions {
  shouldOpen?: (selection: { fileName: string; path?: string }) => boolean | Promise<boolean>;
  preflight?: (selection: {
    fileName: string;
    path?: string;
    fileSize: number;
    headerBytes: Uint8Array;
  }) => void | Promise<void>;
  onSelected?: (selection: { fileName: string; path?: string }) => void | Promise<void>;
}

const NATIVE_READ_CHUNK_SIZE = 8 * 1024 * 1024;
const NATIVE_WRITE_CHUNK_SIZE = 4 * 1024 * 1024;
const NATIVE_WRITE_ID_HEADER = "x-ai-paint-write-id";

function nativeBytesToArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function writeBlobToNativeSession(blob: Blob, writeId: string): Promise<void> {
  for (let offset = 0; offset < blob.size; offset += NATIVE_WRITE_CHUNK_SIZE) {
    const chunk = blob.slice(offset, offset + NATIVE_WRITE_CHUNK_SIZE);
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    await invoke<void>("native_write_file_chunk", bytes, {
      headers: { [NATIVE_WRITE_ID_HEADER]: writeId },
    });
  }
}

function requireSessionId(sessionId: string | null | undefined): string {
  if (!sessionId) {
    throw new Error("ファイル処理セッションを開始できませんでした");
  }
  return sessionId;
}

function requireNativeOpenMetadata(result: NativeBeginOpenResult): {
  fileSize: number;
  headerBytes: Uint8Array;
} {
  if (!Number.isSafeInteger(result.file_size) || (result.file_size ?? -1) < 0) {
    throw new Error("ファイルサイズを確認できませんでした");
  }
  if (!result.header_bytes) {
    throw new Error("ファイルヘッダーを確認できませんでした");
  }
  return {
    fileSize: result.file_size!,
    headerBytes: Uint8Array.from(result.header_bytes),
  };
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

export async function saveBlobToUserPath(
  blob: Blob,
  defaultName: string,
  filter: SaveFileFilter,
): Promise<SaveResult> {
  if (isTauri()) {
    let writeId: string | undefined;
    const result = await invoke<NativeBeginSaveResult>("native_begin_save_file", {
      defaultName,
      filter,
    });
    try {
      if (result.cancelled) return { cancelled: true };
      writeId = requireSessionId(result.write_id);
      await writeBlobToNativeSession(blob, writeId);
      await invoke<void>("native_finish_write_file", { writeId });
      writeId = undefined;
      const path = result.path ?? undefined;
      return {
        cancelled: false,
        path,
        fileName: result.file_name ?? (path ? basename(path) : defaultName),
      };
    } finally {
      if (writeId) {
        await invoke<void>("native_cancel_write_file", { writeId }).catch(() => undefined);
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { cancelled: false, fileName: defaultName };
}

// 既知のパスへ直接 (ダイアログ無しで) 上書き書き込み。Tauri 専用。
// ブラウザ環境では呼ばないこと（呼び出し側で isTauri() を確認する）。
export async function writeBlobToPath(blob: Blob, path: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("ブラウザ環境では直接上書き保存できません");
  }
  let writeId: string | undefined;
  const result = await invoke<NativeBeginWriteResult>("native_begin_write_file", {
    path,
  });
  try {
    writeId = requireSessionId(result.write_id);
    await writeBlobToNativeSession(blob, writeId);
    await invoke<void>("native_finish_write_file", { writeId });
    writeId = undefined;
  } finally {
    if (writeId) {
      await invoke<void>("native_cancel_write_file", { writeId }).catch(() => undefined);
    }
  }
}

async function readNativeOpenResult(
  result: NativeBeginOpenResult,
  options?: OpenFileFromUserPathOptions,
): Promise<OpenResult> {
  let readId: string | undefined;
  try {
    if (result.cancelled) return { cancelled: true };
    readId = requireSessionId(result.read_id);
    const path = result.path ?? undefined;
    const name = result.file_name ?? (path ? basename(path) : "untitled");
    const shouldOpen = await options?.shouldOpen?.({ fileName: name, path });
    if (shouldOpen === false) return { cancelled: true };
    const { fileSize, headerBytes } = requireNativeOpenMetadata(result);
    await options?.preflight?.({ fileName: name, path, fileSize, headerBytes });
    const selectedAt = performance.now();
    await options?.onSelected?.({ fileName: name, path });
    const readStartAt = performance.now();
    const chunks: ArrayBuffer[] = [];
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    let totalBytes = 0;
    for (;;) {
      const chunk = await invoke<ArrayBuffer | Uint8Array>("native_read_file_chunk", {
        readId,
        maxBytes: NATIVE_READ_CHUNK_SIZE,
      });
      const receivedAt = performance.now();
      if (firstChunkAt === null) firstChunkAt = receivedAt;
      const buffer = nativeBytesToArrayBuffer(chunk);
      if (buffer.byteLength === 0) break;
      chunks.push(buffer);
      chunkCount += 1;
      totalBytes += buffer.byteLength;
    }
    const allChunksReadAt = performance.now();
    const finishReadStartedAt = performance.now();
    await invoke<void>("native_finish_read_file", { readId });
    const finishReadMs = performance.now() - finishReadStartedAt;
    readId = undefined;
    // Uint8Array は ArrayBufferLike を持つので File コンストラクタに渡せる。
    const fileConstructionStartedAt = performance.now();
    const file = new File(chunks, name);
    const fileConstructionMs = performance.now() - fileConstructionStartedAt;
    return {
      cancelled: false,
      file,
      path,
      nativeReadTiming: {
        fileName: name,
        path,
        requestedChunkBytes: NATIVE_READ_CHUNK_SIZE,
        chunkCount,
        totalBytes,
        selectedToFirstChunkMs: firstChunkAt === null ? null : firstChunkAt - selectedAt,
        readStartToFirstChunkMs: firstChunkAt === null ? null : firstChunkAt - readStartAt,
        allChunksReadMs: allChunksReadAt - readStartAt,
        finishReadMs,
        fileConstructionMs,
        totalOpenMs: performance.now() - selectedAt,
      },
    };
  } finally {
    if (readId) {
      await invoke<void>("native_cancel_read_file", { readId }).catch(() => undefined);
    }
  }
}

// Tauri ネイティブの open ダイアログでファイルを選び、フルパスと File を返す。
// 純ブラウザでは <input type="file"> 経由になるため、こちらは Tauri 限定で
// 呼び出し側が分岐する。
export async function openFileFromUserPath(
  filters: SaveFileFilter[],
  options?: OpenFileFromUserPathOptions,
): Promise<OpenResult> {
  if (!isTauri()) {
    throw new Error("ブラウザ環境ではこの API は使えません");
  }
  const result = await invoke<NativeBeginOpenResult>("native_begin_open_file", {
    filters,
  });
  return readNativeOpenResult(result, options);
}

export async function takeStartupOpenFiles(
  options?: OpenFileFromUserPathOptions,
): Promise<OpenResult[]> {
  if (!isTauri()) return [];
  const results = await invoke<NativeBeginOpenResult[]>("native_take_startup_open_files");
  const opened: OpenResult[] = [];
  try {
    for (const result of results) {
      opened.push(await readNativeOpenResult(result, options));
    }
  } catch (e) {
    await Promise.all(
      results.map((result) =>
        result.read_id
          ? invoke<void>("native_cancel_read_file", { readId: result.read_id })
              .catch(() => undefined)
          : undefined,
      ),
    );
    throw e;
  }
  return opened;
}
