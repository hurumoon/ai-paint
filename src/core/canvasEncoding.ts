export const IMAGE_ENCODE_ERROR_MESSAGE = "画像のエンコードに失敗しました";

export function htmlCanvasToBlob(
  canvas: HTMLCanvasElement,
  type?: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error(IMAGE_ENCODE_ERROR_MESSAGE));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}
