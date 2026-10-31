export const ALPHA_BOUNDS_SCAN_PIXELS = 1024 * 1024;

export interface AlphaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function scanAlphaBounds(
  imageData: ImageData,
  originX: number,
  originY: number,
  current: AlphaBounds | null
): AlphaBounds | null {
  const { width, height, data } = imageData;
  let bounds = current;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] === 0) continue;
      const docX = originX + x;
      const docY = originY + y;
      if (!bounds) {
        bounds = { minX: docX, minY: docY, maxX: docX, maxY: docY };
      } else {
        bounds.minX = Math.min(bounds.minX, docX);
        bounds.minY = Math.min(bounds.minY, docY);
        bounds.maxX = Math.max(bounds.maxX, docX);
        bounds.maxY = Math.max(bounds.maxY, docY);
      }
    }
  }
  return bounds;
}
