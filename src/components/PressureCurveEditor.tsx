import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeCurve, PRESET_CURVES, PressureCurve } from "../core/pressureCurve";

interface Props {
  curve: PressureCurve;
  onChange: (c: PressureCurve) => void;
}

const SIZE = 140;
const PADDING = 10;

// グラフ座標↔キャンバス座標
function toCanvas(p: { x: number; y: number }): { cx: number; cy: number } {
  const inner = SIZE - PADDING * 2;
  return {
    cx: PADDING + p.x * inner,
    cy: PADDING + (1 - p.y) * inner,
  };
}
function fromCanvas(cx: number, cy: number): { x: number; y: number } {
  const inner = SIZE - PADDING * 2;
  return {
    x: Math.max(0, Math.min(1, (cx - PADDING) / inner)),
    y: Math.max(0, Math.min(1, 1 - (cy - PADDING) / inner)),
  };
}

export function PressureCurveEditor({ curve, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // 描画
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 背景
    const css = getComputedStyle(document.documentElement);
    const border = css.getPropertyValue("--border").trim() || "#444";
    const dim = css.getPropertyValue("--text-faint").trim() || "#888";
    const accent = css.getPropertyValue("--accent").trim() || "#7c8cff";

    // グリッド
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const t = PADDING + ((SIZE - PADDING * 2) * i) / 4;
      ctx.moveTo(PADDING, t);
      ctx.lineTo(SIZE - PADDING, t);
      ctx.moveTo(t, PADDING);
      ctx.lineTo(t, SIZE - PADDING);
    }
    ctx.stroke();

    // 対角線（参考）
    ctx.strokeStyle = dim;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(PADDING, SIZE - PADDING);
    ctx.lineTo(SIZE - PADDING, PADDING);
    ctx.stroke();
    ctx.setLineDash([]);

    // 曲線
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const p of curve.points) {
      const { cx, cy } = toCanvas(p);
      if (p === curve.points[0]) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // 制御点
    ctx.fillStyle = accent;
    for (const p of curve.points) {
      const { cx, cy } = toCanvas(p);
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [curve]);

  const findHitIdx = useCallback(
    (cx: number, cy: number): number => {
      for (let i = 0; i < curve.points.length; i += 1) {
        const { cx: pcx, cy: pcy } = toCanvas(curve.points[i]);
        if (Math.hypot(pcx - cx, pcy - cy) < 8) return i;
      }
      return -1;
    },
    [curve]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const idx = findHitIdx(cx, cy);
    if (idx >= 0) {
      setDraggingIdx(idx);
      e.currentTarget.setPointerCapture(e.pointerId);
      // 端点以外なら右クリック相当で削除も可
      if (e.button === 2 && idx > 0 && idx < curve.points.length - 1) {
        const next = { points: curve.points.filter((_, i) => i !== idx) };
        onChange(normalizeCurve(next));
        setDraggingIdx(null);
        return;
      }
    } else {
      // 新規点を追加
      const newPt = fromCanvas(cx, cy);
      const pts = [...curve.points, newPt].sort((a, b) => a.x - b.x);
      const normalized = normalizeCurve({ points: pts });
      onChange(normalized);
      const newIdx = normalized.points.findIndex(
        (p) => Math.abs(p.x - newPt.x) < 0.001 && Math.abs(p.y - newPt.y) < 0.001
      );
      setDraggingIdx(newIdx >= 0 ? newIdx : null);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingIdx === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const np = fromCanvas(cx, cy);
    const pts = curve.points.map((p, i) => {
      if (i !== draggingIdx) return p;
      // 端点は x 固定
      if (i === 0) return { x: 0, y: np.y };
      if (i === curve.points.length - 1) return { x: 1, y: np.y };
      // 隣との順序を保つために x をクランプ
      const prevX = curve.points[i - 1].x + 0.01;
      const nextX = curve.points[i + 1].x - 0.01;
      return { x: Math.max(prevX, Math.min(nextX, np.x)), y: np.y };
    });
    onChange({ points: pts });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setDraggingIdx(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          cursor: "crosshair",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {Object.entries(PRESET_CURVES).map(([name, c]) => (
          <button
            key={name}
            className="btn ghost"
            style={{ fontSize: 10, padding: "2px 6px" }}
            onClick={() => onChange(c)}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        クリックで点追加 / ドラッグで移動 / 右クリックで点削除
      </div>
    </div>
  );
}
