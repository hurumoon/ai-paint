export const MAX_RASTER_IMAGE_DIMENSION = 16384;

export interface RasterImageDimensions {
  width: number;
  height: number;
}

export function assertRasterImageDimensions({
  width,
  height,
}: RasterImageDimensions): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("画像のサイズが不正です");
  }
  if (width > MAX_RASTER_IMAGE_DIMENSION || height > MAX_RASTER_IMAGE_DIMENSION) {
    throw new Error(
      `画像のサイズが大きすぎます (${width}x${height}, 上限 ${MAX_RASTER_IMAGE_DIMENSION}px)`
    );
  }
}
