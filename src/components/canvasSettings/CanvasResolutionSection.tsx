interface ResolutionPreset {
  label: string;
  w: number;
  h: number;
  dpi?: number;
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
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

interface Props {
  width: number;
  height: number;
  dpi: number;
  setWidth: (n: number) => void;
  setHeight: (n: number) => void;
  setDpi: (n: number) => void;
}

export function CanvasResolutionSection({
  width,
  height,
  dpi,
  setWidth,
  setHeight,
  setDpi,
}: Props) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          プリセット
        </span>
        <select
          className="select"
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
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            minWidth: 36,
          }}
        >
          幅
        </label>
        <input
          type="number"
          className="input"
          value={width}
          min={1}
          max={8192}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>×</span>
        <label
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            minWidth: 36,
          }}
        >
          高さ
        </label>
        <input
          type="number"
          className="input"
          value={height}
          min={1}
          max={8192}
          onChange={(e) => setHeight(Number(e.target.value))}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            minWidth: 36,
          }}
        >
          DPI
        </label>
        <input
          type="number"
          className="input"
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
        DPI は PNG
        エクスポート時にメタデータとして埋め込まれます。キャンバスの実ピクセル数は変わりません。
      </div>
    </>
  );
}
