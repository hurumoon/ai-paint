import {
  PNG_COLOR_TYPE_DEPTHS,
  PNG_SIGNATURE,
} from "./constants";
import { htmlCanvasToBlob } from "../canvasEncoding";
import { fail } from "./errors";

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

export function assertPngHeader(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
  fileName: string
): void {
  if (bytes.byteLength < 33) fail(`PNGヘッダが不正です: ${fileName}`);
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) fail(`PNGシグネチャが不正です: ${fileName}`);
  }
  const ihdrLength = readU32BE(bytes, 8);
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrLength !== 13 || chunkType !== "IHDR") {
    fail(`PNG IHDR が不正です: ${fileName}`);
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const allowedDepths = PNG_COLOR_TYPE_DEPTHS.get(colorType);
  if (!allowedDepths || !allowedDepths.has(bitDepth)) {
    fail(`PNG形式が不正です: ${fileName}`);
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    fail(
      `レイヤーPNGのサイズが不正です (${fileName}: ${width}x${height}, 必要 ${expectedWidth}x${expectedHeight})`
    );
  }
}

export async function decodePngToCanvas(
  bytes: Uint8Array,
  fileName: string,
  expectedWidth: number,
  expectedHeight: number
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  assertPngHeader(bytes, expectedWidth, expectedHeight, fileName);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "image/png" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error(
      `レイヤーPNGを読み込めません (${fileName}): ${e instanceof Error ? e.message : e}`
    );
  }
  const bitmapWidth = bitmap.width;
  const bitmapHeight = bitmap.height;
  if (bitmapWidth !== expectedWidth || bitmapHeight !== expectedHeight) {
    bitmap.close();
    fail(
      `レイヤーPNGのサイズが不正です (${fileName}: ${bitmapWidth}x${bitmapHeight}, 必要 ${expectedWidth}x${expectedHeight})`
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = expectedWidth;
  canvas.height = expectedHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, ctx };
}

export async function canvasToPngBytes(
  canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<Uint8Array> {
  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    blob = await htmlCanvasToBlob(canvas as HTMLCanvasElement, "image/png");
  }
  return new Uint8Array(await blob.arrayBuffer());
}
