// PNG pHYs チャンクを埋め込んで DPI 情報を持たせる。
// PNG は IHDR の直後あたりに pHYs を入れる仕様。ここでは IHDR の直後に挿入する。
// dpi (1インチあたりのドット数) → ピクセル/メートル に変換: pixels_per_meter = dpi * 39.3701

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PX_PER_METER_PER_DPI = 39.3701;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7]
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

// pHYs チャンクのバイト列を生成
function buildPhysChunk(dpi: number): Uint8Array {
  const pxPerM = Math.round(dpi * PX_PER_METER_PER_DPI);
  // pHYs データ部: 4byte ppuX, 4byte ppuY, 1byte unit(1=meter)
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  writeUint32BE(dv, 0, pxPerM);
  writeUint32BE(dv, 4, pxPerM);
  data[8] = 1;

  // チャンク = length(4) + type(4) + data + crc(4)
  const type = new TextEncoder().encode("pHYs");
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const cdv = new DataView(chunk.buffer);
  writeUint32BE(cdv, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);

  // CRC は type+data
  const crcInput = new Uint8Array(type.length + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, type.length);
  writeUint32BE(cdv, 8 + data.length, crc32(crcInput));
  return chunk;
}

export function readPngDpi(pngBytes: Uint8Array): number | null {
  if (pngBytes.length < 24 || !isPng(pngBytes)) return null;

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = readUint32BE(pngBytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > pngBytes.length) return null;
    const type = readChunkType(pngBytes, offset);
    if (type === "pHYs" && length === 9) {
      const dataOffset = offset + 8;
      const unit = pngBytes[dataOffset + 8];
      if (unit !== 1) return null;
      const xPixelsPerMeter = readUint32BE(pngBytes, dataOffset);
      if (xPixelsPerMeter <= 0) return null;
      return Math.max(1, Math.round(xPixelsPerMeter / PX_PER_METER_PER_DPI));
    }
    if (type === "IDAT" || type === "IEND") return null;
    offset = chunkEnd;
  }
  return null;
}

// 既存PNGバイト列に pHYs を IHDR の直後に挿入したものを返す
export function injectPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  // PNGシグネチャ8byte → 最初のチャンク（IHDR） を読み、その直後に挿入する。
  // 既存の pHYs があれば二重化せず、新しい値に置き換える。
  if (pngBytes.length < 24 || !isPng(pngBytes)) return pngBytes;
  const phys = buildPhysChunk(dpi);

  const chunks: Uint8Array[] = [pngBytes.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  let totalLength = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = readUint32BE(pngBytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > pngBytes.length) return pngBytes;

    const type = readChunkType(pngBytes, offset);
    if (type !== "pHYs") {
      const chunk = pngBytes.subarray(offset, chunkEnd);
      chunks.push(chunk);
      totalLength += chunk.length;
    }
    if (type === "IHDR") {
      chunks.push(phys);
      totalLength += phys.length;
      inserted = true;
    }

    offset = chunkEnd;
    if (type === "IEND") break;
  }

  if (!inserted) return pngBytes;
  const out = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    out.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return out;
}

export async function blobWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const withDpi = injectPngDpi(buf, dpi);
  // Uint8Array → ArrayBuffer に確実にコピーして Blob に渡す
  const ab = new ArrayBuffer(withDpi.byteLength);
  new Uint8Array(ab).set(withDpi);
  return new Blob([ab], { type: "image/png" });
}
