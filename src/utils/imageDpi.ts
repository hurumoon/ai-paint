import { blobWithDpi, readPngDpi } from "./pngDpi";

export type RasterImageFormat = "png" | "jpeg" | "webp";

const JPEG_SOI_0 = 0xff;
const JPEG_SOI_1 = 0xd8;

function clampDpi(dpi: number): number {
  return Math.min(65535, Math.max(1, Math.round(dpi)));
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function writeUint16BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function bytesMatch(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function tiffUint16(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number {
  return view.getUint16(offset, littleEndian);
}

function tiffUint32(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number {
  return view.getUint32(offset, littleEndian);
}

function readTiffShort(
  view: DataView,
  entryOffset: number,
  littleEndian: boolean,
): number | null {
  const type = tiffUint16(view, entryOffset + 2, littleEndian);
  const count = tiffUint32(view, entryOffset + 4, littleEndian);
  if (type !== 3 || count < 1) return null;
  return tiffUint16(view, entryOffset + 8, littleEndian);
}

function readTiffRational(
  view: DataView,
  tiffStart: number,
  tiffEnd: number,
  entryOffset: number,
  littleEndian: boolean,
): number | null {
  const type = tiffUint16(view, entryOffset + 2, littleEndian);
  const count = tiffUint32(view, entryOffset + 4, littleEndian);
  if (type !== 5 || count < 1) return null;

  const valueOffset = tiffStart + tiffUint32(view, entryOffset + 8, littleEndian);
  if (valueOffset < tiffStart || valueOffset + 8 > tiffEnd) return null;

  const numerator = tiffUint32(view, valueOffset, littleEndian);
  const denominator = tiffUint32(view, valueOffset + 4, littleEndian);
  if (denominator === 0) return null;
  return numerator / denominator;
}

function readTiffDpi(bytes: Uint8Array, tiffStart: number, tiffEnd: number): number | null {
  if (tiffStart + 8 > tiffEnd) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endianA = bytes[tiffStart];
  const endianB = bytes[tiffStart + 1];
  const littleEndian = endianA === 0x49 && endianB === 0x49;
  const bigEndian = endianA === 0x4d && endianB === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  if (tiffUint16(view, tiffStart + 2, littleEndian) !== 42) return null;

  const ifdOffset = tiffStart + tiffUint32(view, tiffStart + 4, littleEndian);
  if (ifdOffset < tiffStart || ifdOffset + 2 > tiffEnd) return null;
  const entryCount = tiffUint16(view, ifdOffset, littleEndian);
  if (ifdOffset + 2 + entryCount * 12 > tiffEnd) return null;

  let xResolution: number | null = null;
  let yResolution: number | null = null;
  let resolutionUnit = 2;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = tiffUint16(view, entryOffset, littleEndian);
    if (tag === 0x011a) {
      xResolution = readTiffRational(view, tiffStart, tiffEnd, entryOffset, littleEndian);
    } else if (tag === 0x011b) {
      yResolution = readTiffRational(view, tiffStart, tiffEnd, entryOffset, littleEndian);
    } else if (tag === 0x0128) {
      resolutionUnit = readTiffShort(view, entryOffset, littleEndian) ?? resolutionUnit;
    }
  }

  const resolution = xResolution ?? yResolution;
  if (!resolution || resolution <= 0) return null;
  if (resolutionUnit === 2) return clampDpi(resolution);
  if (resolutionUnit === 3) return clampDpi(resolution * 2.54);
  return null;
}

function readJfifDpi(bytes: Uint8Array, dataStart: number, dataEnd: number): number | null {
  if (!isJfifSegment(bytes, dataStart, dataEnd)) return null;
  const units = bytes[dataStart + 7];
  const xDensity = readUint16BE(bytes, dataStart + 8);
  const yDensity = readUint16BE(bytes, dataStart + 10);
  const density = xDensity || yDensity;
  if (density <= 0) return null;
  if (units === 1) return clampDpi(density);
  if (units === 2) return clampDpi(density * 2.54);
  return null;
}

function isJfifSegment(bytes: Uint8Array, dataStart: number, dataEnd: number): boolean {
  return dataStart + 14 <= dataEnd && bytesMatch(bytes, dataStart, "JFIF\0");
}

function readExifDpi(bytes: Uint8Array, dataStart: number, dataEnd: number): number | null {
  if (dataStart + 6 <= dataEnd && bytesMatch(bytes, dataStart, "Exif\0\0")) {
    return readTiffDpi(bytes, dataStart + 6, dataEnd);
  }
  return readTiffDpi(bytes, dataStart, dataEnd);
}

function readJpegDpi(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== JPEG_SOI_0 || bytes[1] !== JPEG_SOI_1) return null;

  let exifDpi: number | null = null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (isStandaloneJpegMarker(marker)) continue;
    if (offset + 2 > bytes.length) break;

    const segmentLength = readUint16BE(bytes, offset);
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    if (segmentLength < 2 || dataEnd > bytes.length) break;

    if (marker === 0xe0) {
      const jfifDpi = readJfifDpi(bytes, dataStart, dataEnd);
      if (jfifDpi !== null) return jfifDpi;
    } else if (marker === 0xe1) {
      exifDpi = readExifDpi(bytes, dataStart, dataEnd) ?? exifDpi;
    }

    offset = dataEnd;
  }
  return exifDpi;
}

function readWebpDpi(bytes: Uint8Array): number | null {
  if (
    bytes.length < 20 ||
    !bytesMatch(bytes, 0, "RIFF") ||
    !bytesMatch(bytes, 8, "WEBP")
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > bytes.length) return null;
    if (bytesMatch(bytes, offset, "EXIF")) {
      return readExifDpi(bytes, dataStart, dataEnd);
    }
    offset = dataEnd + (chunkSize % 2);
  }
  return null;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function buildExifDpiData(dpi: number): Uint8Array {
  const density = clampDpi(dpi);
  const bytes = new Uint8Array(66);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  writeUint16LE(bytes, 2, 42);
  writeUint32LE(bytes, 4, 8);
  writeUint16LE(bytes, 8, 3);

  writeUint16LE(bytes, 10, 0x011a);
  writeUint16LE(bytes, 12, 5);
  writeUint32LE(bytes, 14, 1);
  writeUint32LE(bytes, 18, 50);

  writeUint16LE(bytes, 22, 0x011b);
  writeUint16LE(bytes, 24, 5);
  writeUint32LE(bytes, 26, 1);
  writeUint32LE(bytes, 30, 58);

  writeUint16LE(bytes, 34, 0x0128);
  writeUint16LE(bytes, 36, 3);
  writeUint32LE(bytes, 38, 1);
  writeUint16LE(bytes, 42, 2);
  writeUint32LE(bytes, 46, 0);

  writeUint32LE(bytes, 50, density);
  writeUint32LE(bytes, 54, 1);
  writeUint32LE(bytes, 58, density);
  writeUint32LE(bytes, 62, 1);
  return bytes;
}

function buildRiffChunk(type: string, data: Uint8Array): Uint8Array {
  const paddedLength = data.length + (data.length % 2);
  const chunk = new Uint8Array(8 + paddedLength);
  for (let i = 0; i < 4; i += 1) chunk[i] = type.charCodeAt(i);
  writeUint32LE(chunk, 4, data.length);
  chunk.set(data, 8);
  return chunk;
}

function injectWebpDpi(webpBytes: Uint8Array, dpi: number): Uint8Array {
  if (
    webpBytes.length < 20 ||
    !bytesMatch(webpBytes, 0, "RIFF") ||
    !bytesMatch(webpBytes, 8, "WEBP")
  ) {
    return webpBytes;
  }

  const chunks: Uint8Array[] = [];
  let offset = 12;
  let chunksLength = 0;
  while (offset + 8 <= webpBytes.length) {
    const chunkSize = new DataView(webpBytes.buffer, webpBytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const chunkEnd = offset + 8 + chunkSize + (chunkSize % 2);
    if (chunkEnd > webpBytes.length) return webpBytes;
    if (!bytesMatch(webpBytes, offset, "EXIF")) {
      const chunk = webpBytes.subarray(offset, chunkEnd);
      chunks.push(chunk);
      chunksLength += chunk.length;
    }
    offset = chunkEnd;
  }

  const exifChunk = buildRiffChunk("EXIF", buildExifDpiData(dpi));
  chunks.push(exifChunk);
  chunksLength += exifChunk.length;

  const out = new Uint8Array(12 + chunksLength);
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46;
  writeUint32LE(out, 4, 4 + chunksLength);
  out[8] = 0x57;
  out[9] = 0x45;
  out[10] = 0x42;
  out[11] = 0x50;

  let writeOffset = 12;
  for (const chunk of chunks) {
    out.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return out;
}

function buildJfifSegment(dpi: number): Uint8Array {
  const density = clampDpi(dpi);
  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  writeUint16BE(segment, 2, 16);
  segment[4] = 0x4a;
  segment[5] = 0x46;
  segment[6] = 0x49;
  segment[7] = 0x46;
  segment[8] = 0x00;
  segment[9] = 0x01;
  segment[10] = 0x02;
  segment[11] = 0x01;
  writeUint16BE(segment, 12, density);
  writeUint16BE(segment, 14, density);
  segment[16] = 0x00;
  segment[17] = 0x00;
  return segment;
}

function injectJpegDpi(jpegBytes: Uint8Array, dpi: number): Uint8Array {
  if (
    jpegBytes.length < 4 ||
    jpegBytes[0] !== JPEG_SOI_0 ||
    jpegBytes[1] !== JPEG_SOI_1
  ) {
    return jpegBytes;
  }

  let offset = 2;
  while (offset + 4 <= jpegBytes.length) {
    if (jpegBytes[offset] !== 0xff) break;
    while (offset < jpegBytes.length && jpegBytes[offset] === 0xff) offset += 1;
    if (offset >= jpegBytes.length) break;

    const markerOffset = offset - 1;
    const marker = jpegBytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (isStandaloneJpegMarker(marker)) continue;
    if (offset + 2 > jpegBytes.length) break;

    const segmentLength = readUint16BE(jpegBytes, offset);
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    if (segmentLength < 2 || dataEnd > jpegBytes.length) break;

    if (marker === 0xe0 && isJfifSegment(jpegBytes, dataStart, dataEnd)) {
      const out = new Uint8Array(jpegBytes);
      const density = clampDpi(dpi);
      out[dataStart + 7] = 1;
      writeUint16BE(out, dataStart + 8, density);
      writeUint16BE(out, dataStart + 10, density);
      return out;
    }

    offset = dataEnd;
    if (markerOffset > 2) break;
  }

  const jfif = buildJfifSegment(dpi);
  const out = new Uint8Array(jpegBytes.length + jfif.length);
  out.set(jpegBytes.subarray(0, 2), 0);
  out.set(jfif, 2);
  out.set(jpegBytes.subarray(2), 2 + jfif.length);
  return out;
}

export async function readImageDpi(file: Blob): Promise<number | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readPngDpi(bytes) ?? readJpegDpi(bytes) ?? readWebpDpi(bytes);
}

export async function blobWithImageDpi(
  blob: Blob,
  format: RasterImageFormat,
  dpi: number,
): Promise<Blob> {
  if (format === "png") return blobWithDpi(blob, dpi);
  if (format === "jpeg") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const withDpi = injectJpegDpi(bytes, dpi);
    const ab = new ArrayBuffer(withDpi.byteLength);
    new Uint8Array(ab).set(withDpi);
    return new Blob([ab], { type: "image/jpeg" });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const withDpi = injectWebpDpi(bytes, dpi);
  const ab = new ArrayBuffer(withDpi.byteLength);
  new Uint8Array(ab).set(withDpi);
  return new Blob([ab], { type: "image/webp" });
}
