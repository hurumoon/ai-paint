import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCurveLUT } from "../../core/colorAdjust";
import { Button } from "../../ui/primitives";
import { CURVE_DEFAULT, CurvePoint } from "./ColorAdjustTypes";

interface Props {
  points: CurvePoint[];
  onChange: (p: CurvePoint[]) => void;
}

// 256x256 を中央に持つ。クリックで点追加、ドラッグで移動、右クリックで削除。
// 端の 2 点 (x=0, x=255) は削除不可だが移動可能。
export function CurveEditor({ points, onChange }: Props) {
  const SIZE = 200;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const lut = useMemo(() => buildCurveLUT(points), [points]);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const css = getComputedStyle(document.documentElement);
    const border = css.getPropertyValue("--border").trim() || "#444";
    const dim = css.getPropertyValue("--text-faint").trim() || "#888";
    const accent = css.getPropertyValue("--accent").trim() || "#7c8cff";

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const t = (SIZE * i) / 4;
      ctx.moveTo(0, t);
      ctx.lineTo(SIZE, t);
      ctx.moveTo(t, 0);
      ctx.lineTo(t, SIZE);
    }
    ctx.stroke();

    ctx.strokeStyle = dim;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 255) * SIZE;
      const y = SIZE - (lut[i] / 255) * SIZE;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = accent;
    for (const p of points) {
      const cx = (p.x / 255) * SIZE;
      const cy = SIZE - (p.y / 255) * SIZE;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [lut, points]);

  useEffect(() => {
    draw();
  }, [draw]);

  const eventToGraph = useCallback(
    (
      e:
        | React.PointerEvent<HTMLCanvasElement>
        | React.MouseEvent<HTMLCanvasElement>
    ) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const x = Math.max(0, Math.min(255, Math.round((px / rect.width) * 255)));
      const y = Math.max(
        0,
        Math.min(255, Math.round(((rect.height - py) / rect.height) * 255))
      );
      return { x, y };
    },
    []
  );

  const findNearby = useCallback(
    (gx: number, gy: number): number => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < points.length; i += 1) {
        const dx = points[i].x - gx;
        const dy = points[i].y - gy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return bestD <= 12 * 12 ? best : -1;
    },
    [points]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = eventToGraph(e);
    if (e.button === 2) return;
    const hit = findNearby(x, y);
    if (hit >= 0) {
      setDraggingIdx(hit);
      return;
    }
    const next = [...points, { x, y }].sort((a, b) => a.x - b.x);
    onChange(next);
    const newIdx = next.findIndex((p) => p.x === x && p.y === y);
    setDraggingIdx(newIdx);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingIdx == null) return;
    const { x, y } = eventToGraph(e);
    const next = points.map((p, i) => (i === draggingIdx ? { x, y } : p));
    next.sort((a, b) => a.x - b.x);
    onChange(next);
    const newIdx = next.findIndex((p) => p.x === x && p.y === y);
    if (newIdx >= 0) setDraggingIdx(newIdx);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    setDraggingIdx(null);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (points.length <= 2) return;
    const { x, y } = eventToGraph(e);
    const hit = findNearby(x, y);
    if (hit >= 0 && points.length > 2) {
      const next = points.filter((_, i) => i !== hit);
      onChange(next);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{
          width: SIZE,
          height: SIZE,
          alignSelf: "center",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          touchAction: "none",
          cursor: draggingIdx != null ? "grabbing" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
      />
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        クリックで点追加 / ドラッグで移動 / 右クリックで削除
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Button onClick={() => onChange(CURVE_DEFAULT)}>リセット</Button>
        <Button
          onClick={() =>
            onChange([
              { x: 0, y: 0 },
              { x: 64, y: 48 },
              { x: 192, y: 208 },
              { x: 255, y: 255 },
            ])
          }
        >
          S字 (コントラスト+)
        </Button>
        <Button
          onClick={() =>
            onChange([
              { x: 0, y: 0 },
              { x: 64, y: 80 },
              { x: 192, y: 176 },
              { x: 255, y: 255 },
            ])
          }
        >
          逆S字 (コントラスト−)
        </Button>
      </div>
    </div>
  );
}
