import { useEffect, useRef } from "react";

interface Props {
  hist: Uint32Array;
  inBlack: number;
  inWhite: number;
}

export function HistogramView({ hist, inBlack, inWhite }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const w = 256;
  const h = 60;
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const border = css.getPropertyValue("--border").trim() || "#444";
    const dim = css.getPropertyValue("--text-faint").trim() || "#888";
    const accent = css.getPropertyValue("--accent").trim() || "#7c8cff";

    let max = 0;
    for (let i = 0; i < 256; i += 1) {
      if (hist[i] > max) max = hist[i];
    }
    const logMax = Math.log(max + 1);
    ctx.fillStyle = dim;
    for (let i = 0; i < 256; i += 1) {
      const v = Math.log(hist[i] + 1) / logMax;
      const bh = Math.max(0, Math.min(h, v * h));
      ctx.fillRect(i, h - bh, 1, bh);
    }

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inBlack + 0.5, 0);
    ctx.lineTo(inBlack + 0.5, h);
    ctx.moveTo(inWhite + 0.5, 0);
    ctx.lineTo(inWhite + 0.5, h);
    ctx.stroke();

    ctx.strokeStyle = border;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [hist, inBlack, inWhite]);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      style={{
        width: "100%",
        height: 60,
        imageRendering: "pixelated",
        border: "1px solid var(--border)",
      }}
    />
  );
}
