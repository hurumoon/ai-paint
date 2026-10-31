// PSD 本体を JavaScript メモリへ読み込む前に実行できる軽量検査。
// Tauri のネイティブ読み込みとブラウザの Blob 読み込みで同じ制約を使う。

export const MAX_PSD_FILE_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_PSD_DIMENSION = 16384;
export const PSD_HEADER_BYTES = 26;

export interface PsdHeaderSummary {
  width: number;
  height: number;
  bitsPerChannel: number;
}

function corruptPsdError(detail: string): Error {
  return new Error(`PSD ファイルが破損しているか未対応の形式です: ${detail}`);
}

export function assertPsdDocumentDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("PSD のサイズが不正です");
  }
  if (width > MAX_PSD_DIMENSION || height > MAX_PSD_DIMENSION) {
    throw new Error(
      `PSD のサイズが大きすぎます (${width}x${height}, 上限 ${MAX_PSD_DIMENSION}px)`
    );
  }
}

export function parsePsdHeader(headerBytes: Uint8Array): PsdHeaderSummary {
  if (headerBytes.byteLength < PSD_HEADER_BYTES) {
    throw corruptPsdError("PSD ヘッダーが途中で切れています");
  }
  if (
    headerBytes[0] !== 0x38 ||
    headerBytes[1] !== 0x42 ||
    headerBytes[2] !== 0x50 ||
    headerBytes[3] !== 0x53
  ) {
    throw corruptPsdError("PSD ヘッダーの署名が不正です");
  }
  const view = new DataView(
    headerBytes.buffer,
    headerBytes.byteOffset,
    headerBytes.byteLength,
  );
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) {
    throw corruptPsdError(`PSD バージョン ${version} には対応していません`);
  }
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  const bitsPerChannel = view.getUint16(22, false);
  assertPsdDocumentDimensions(width, height);
  return { width, height, bitsPerChannel };
}

export function preflightPsdOpen(
  fileSize: number,
  headerBytes: Uint8Array,
): PsdHeaderSummary {
  assertPsdFileSize(fileSize);
  return parsePsdHeader(headerBytes);
}

export function assertPsdFileSize(fileSize: number): void {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error("PSD ファイルサイズを確認できません");
  }
  if (fileSize > MAX_PSD_FILE_BYTES) {
    throw new Error(
      `PSD ファイルが大きすぎます (${Math.round(fileSize / 1024 / 1024)}MB, 上限 ${MAX_PSD_FILE_BYTES / 1024 / 1024}MB)`
    );
  }
}
