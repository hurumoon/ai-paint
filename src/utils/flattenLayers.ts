// 全レイヤーを合成して1枚のPNG base64にする（AI送信用）
export function flattenLayers(
  layers: (HTMLCanvasElement | null)[],
  visibility: boolean[],
  width: number,
  height: number
): string {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;

  // 白背景
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer && visibility[i]) {
      ctx.drawImage(layer, 0, 0);
    }
  }

  // PNG dataURLからbase64部分だけ抜く
  const dataUrl = out.toDataURL("image/png");
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}
