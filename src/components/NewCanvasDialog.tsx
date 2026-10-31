import { useEffect, useState } from "react";
import { Button } from "../ui/primitives";
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_DPI,
} from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (width: number, height: number, dpi: number) => void;
}

const RESOLUTION_PRESETS = [
  { label: "SD (1024×768)", w: 1024, h: 768 },
  { label: "正方形 (1024)", w: 1024, h: 1024 },
  { label: "HD (1280×720)", w: 1280, h: 720 },
  { label: "FHD (1920×1080)", w: 1920, h: 1080 },
  { label: "QHD (2560×1440)", w: 2560, h: 1440 },
  { label: "4K (3840×2160)", w: 3840, h: 2160 },
  { label: "縦 (768×1024)", w: 768, h: 1024 },
  { label: "縦（FHD） (1080×1920)", w: 1080, h: 1920 },
  { label: "縦（QHD） (1440×2560)", w: 1440, h: 2560 },
  { label: "縦（4K） (2160×3840)", w: 2160, h: 3840 },
  { label: "A4 印刷 300dpi (2480×3508)", w: 2480, h: 3508, dpi: 300 },
  { label: "A5 印刷 300dpi (1748×2480)", w: 1748, h: 2480, dpi: 300 },
];

export function NewCanvasDialog({ open, onClose, onConfirm }: Props) {
  const [width, setWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const [height, setHeight] = useState(DEFAULT_CANVAS_HEIGHT);
  const [dpi, setDpi] = useState(DEFAULT_DPI);

  useEffect(() => {
    if (!open) return;
    setWidth(DEFAULT_CANVAS_WIDTH);
    setHeight(DEFAULT_CANVAS_HEIGHT);
    setDpi(DEFAULT_DPI);
  }, [open]);

  if (!open) return null;

  const apply = () => {
    const w = Math.max(1, Math.min(8192, Math.round(width)));
    const h = Math.max(1, Math.min(8192, Math.round(height)));
    const d = Math.max(1, Math.min(2400, Math.round(dpi)));
    onConfirm(w, h, d);
    onClose();
  };

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="popover"
        data-testid="new-canvas-dialog"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          minWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>新規キャンバス</strong>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            プリセット
          </span>
          <select
            className="select"
            data-testid="new-canvas-resolution-preset"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const p = RESOLUTION_PRESETS.find((x) => `${x.w}x${x.h}` === v);
              if (p) {
                setWidth(p.w);
                setHeight(p.h);
                if (p.dpi) setDpi(p.dpi);
              }
            }}
          >
            <option value="">— 選択 —</option>
            {RESOLUTION_PRESETS.map((p) => (
              <option key={p.label} value={`${p.w}x${p.h}`}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label
            style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 36 }}
          >
            幅
          </label>
          <input
            type="number"
            className="input"
            data-testid="new-canvas-width"
            value={width}
            min={1}
            max={8192}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>×</span>
          <label
            style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 36 }}
          >
            高さ
          </label>
          <input
            type="number"
            className="input"
            data-testid="new-canvas-height"
            value={height}
            min={1}
            max={8192}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label
            style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 36 }}
          >
            DPI
          </label>
          <input
            type="number"
            className="input"
            data-testid="new-canvas-dpi"
            value={dpi}
            min={1}
            max={2400}
            onChange={(e) => setDpi(Number(e.target.value))}
          />
          <select
            className="select"
            value=""
            onChange={(e) => e.target.value && setDpi(Number(e.target.value))}
            style={{ maxWidth: 120 }}
          >
            <option value="">プリセット</option>
            <option value="72">72 (Web)</option>
            <option value="96">96 (Win 既定)</option>
            <option value="150">150</option>
            <option value="300">300 (印刷)</option>
            <option value="600">600 (高品質印刷)</option>
          </select>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          現在のキャンバスは残したまま、新しいタブで空のキャンバスを作成します。
        </div>

        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Button data-testid="new-canvas-cancel" onClick={onClose}>キャンセル</Button>
          <Button data-testid="new-canvas-create" variant="primary" onClick={apply}>
            作成
          </Button>
        </div>
      </div>
    </>
  );
}
