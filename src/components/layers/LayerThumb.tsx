import { useEffect, useRef } from "react";
import { PixelLayer } from "../../core/PaintDocument";

const THUMB_W = 28;
const THUMB_H = 22;

interface Props {
  layer: PixelLayer;
  docWidth: number;
  docHeight: number;
}

export function LayerThumb({ layer, docWidth, docHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(THUMB_W * dpr));
    const pxH = Math.max(1, Math.round(THUMB_H * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (docWidth <= 0 || docHeight <= 0) return;
    const scale = Math.min(canvas.width / docWidth, canvas.height / docHeight);
    const dw = docWidth * scale;
    const dh = docHeight * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    const def = layer.deferred;
    if (def) {
      const sw = def.bboxWidth * scale;
      const sh = def.bboxHeight * scale;
      layer.store.drawToScaled(
        ctx,
        dx + def.offsetX * scale,
        dy + def.offsetY * scale,
        sw,
        sh
      );
    } else {
      layer.store.drawToScaled(ctx, dx, dy, dw, dh);
    }
  });

  return <canvas ref={canvasRef} className="thumb-canvas" />;
}
