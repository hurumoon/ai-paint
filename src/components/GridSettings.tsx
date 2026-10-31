import { Slider } from "../ui/primitives";

export interface GridConfig {
  show: boolean;
  spacing: number; // canvas座標
  color: string;
  divisions: number; // 0 で副グリッドなし
}

interface Props {
  grid: GridConfig;
  setGrid: (g: GridConfig) => void;
}

export function GridSettings({ grid, setGrid }: Props) {
  return (
    <div className="section">
      <div className="section-title">
        <span>グリッド</span>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            color: "var(--text-dim)",
            textTransform: "none",
            letterSpacing: 0,
            fontWeight: 400,
          }}
        >
          <input
            type="checkbox"
            checked={grid.show}
            onChange={(e) => setGrid({ ...grid, show: e.target.checked })}
          />
          表示
        </label>
      </div>
      <Slider
        label="間隔"
        value={grid.spacing}
        min={4}
        max={512}
        onChange={(v) => setGrid({ ...grid, spacing: v })}
        format={(v) => `${v}px`}
      />
      <Slider
        label="分割"
        value={grid.divisions}
        min={0}
        max={10}
        onChange={(v) => setGrid({ ...grid, divisions: v })}
        format={(v) => (v === 0 ? "なし" : `${v}`)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>色</span>
        <input
          type="color"
          value={grid.color}
          onChange={(e) => setGrid({ ...grid, color: e.target.value })}
          style={{ width: 32, height: 22, border: "none", padding: 0, background: "transparent" }}
        />
      </div>
    </div>
  );
}
