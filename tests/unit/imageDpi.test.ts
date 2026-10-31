import { describe, expect, it } from "vitest";
import { blobWithImageDpi, readImageDpi } from "../../src/utils/imageDpi";

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  return chunk;
}

function minimalPng(): Blob {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, 1);
  writeUint32BE(ihdr, 4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Blob([signature, pngChunk("IHDR", ihdr), pngChunk("IEND")], {
    type: "image/png",
  });
}

function minimalJpeg(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
}

function minimalWebp(): Blob {
  const riff = new Uint8Array(20);
  riff.set(ascii("RIFF"), 0);
  writeUint32LE(riff, 4, 12);
  riff.set(ascii("WEBP"), 8);
  riff.set(ascii("VP8 "), 12);
  writeUint32LE(riff, 16, 0);
  return new Blob([riff], { type: "image/webp" });
}

describe("image DPI metadata", () => {
  it("injects and reads PNG pHYs DPI metadata", async () => {
    const withDpi = await blobWithImageDpi(minimalPng(), "png", 144);

    await expect(readImageDpi(withDpi)).resolves.toBe(144);
  });

  it("injects and reads JPEG JFIF DPI metadata", async () => {
    const withDpi = await blobWithImageDpi(minimalJpeg(), "jpeg", 300);

    await expect(readImageDpi(withDpi)).resolves.toBe(300);
  });

  it("injects and reads WebP EXIF DPI metadata", async () => {
    const withDpi = await blobWithImageDpi(minimalWebp(), "webp", 72);

    await expect(readImageDpi(withDpi)).resolves.toBe(72);
  });

  it("returns null for images without supported DPI metadata", async () => {
    await expect(readImageDpi(minimalPng())).resolves.toBeNull();
    await expect(readImageDpi(minimalJpeg())).resolves.toBeNull();
    await expect(readImageDpi(minimalWebp())).resolves.toBeNull();
  });
});
