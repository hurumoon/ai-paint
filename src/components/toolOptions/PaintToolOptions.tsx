import type {
  GradientKind,
  GradientPreset,
  ShapeKind,
} from "../../types";
import type { ReactNode } from "react";
import { ColorSwatch, Slider, Tabs } from "../../ui/primitives";

const SHAPE_OPTIONS: { value: ShapeKind; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "ellipse", label: "楕円" },
  { value: "line", label: "直線" },
  { value: "polygon", label: "星" },
];

interface BucketOptionsProps {
  color: string;
  setColor: (c: string) => void;
  secondaryColor: string;
  setSecondaryColor: (c: string) => void;
  bucketTolerance: number;
  setBucketTolerance: (n: number) => void;
  bucketGapClose: number;
  setBucketGapClose: (n: number) => void;
  bucketExpand: number;
  setBucketExpand: (n: number) => void;
  colorHistorySection: ReactNode;
}

interface GradientOptionsProps {
  gradientKind: GradientKind;
  setGradientKind: (k: GradientKind) => void;
  gradientToTransparent: boolean;
  setGradientToTransparent: (b: boolean) => void;
  gradientPreset: GradientPreset;
  setGradientPreset: (p: GradientPreset) => void;
}

interface ShapeOptionsProps {
  shapeKind: ShapeKind;
  setShapeKind: (k: ShapeKind) => void;
  shapeFill: boolean;
  setShapeFill: (b: boolean) => void;
  shapeStroke: boolean;
  setShapeStroke: (b: boolean) => void;
  shapeStrokeWidth: number;
  setShapeStrokeWidth: (n: number) => void;
}

interface BlurOptionsProps {
  blurRadius: number;
  setBlurRadius: (n: number) => void;
}

export function BucketOptions({
  color,
  setColor,
  secondaryColor,
  setSecondaryColor,
  bucketTolerance,
  setBucketTolerance,
  bucketGapClose,
  setBucketGapClose,
  bucketExpand,
  setBucketExpand,
  colorHistorySection,
}: BucketOptionsProps) {
  return (
    <>
      <div className="section">
        <div className="section-title">色</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ColorSwatch color={color} onChange={setColor} size="large" />
          <ColorSwatch
            color={secondaryColor}
            onChange={setSecondaryColor}
          />
        </div>
        {colorHistorySection}
      </div>
      <div className="section">
        <div className="section-title">塗りつぶし</div>
        <Slider
          label="許容差"
          value={bucketTolerance}
          min={0}
          max={128}
          onChange={setBucketTolerance}
          format={(v) => `${v}`}
        />
        <Slider
          label="隙間閉じ"
          value={bucketGapClose}
          min={0}
          max={16}
          onChange={setBucketGapClose}
          format={(v) => `${v}px`}
        />
        <Slider
          label="領域拡大"
          value={bucketExpand}
          min={0}
          max={16}
          onChange={setBucketExpand}
          format={(v) => `${v}px`}
        />
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          線画の隙間を埋めて塗る/塗り結果を太らせて線の下に潜らせる
        </div>
      </div>
    </>
  );
}

export function GradientOptions({
  gradientKind,
  setGradientKind,
  gradientToTransparent,
  setGradientToTransparent,
  gradientPreset,
  setGradientPreset,
}: GradientOptionsProps) {
  const isRainbow = gradientPreset === "rainbow";
  return (
    <div className="section">
      <div className="section-title">グラデーション</div>
      <Tabs
        value={gradientKind}
        onChange={setGradientKind}
        options={[
          { value: "linear", label: "線形" },
          { value: "radial", label: "放射" },
        ]}
      />
      <Tabs
        value={gradientPreset}
        onChange={setGradientPreset}
        options={[
          { value: "two-color", label: "2色" },
          { value: "rainbow", label: "🌈 虹色" },
        ]}
      />
      {isRainbow && (
        <div
          style={{
            height: 14,
            borderRadius: 4,
            background:
              "linear-gradient(90deg,#ff0000 0%,#ff8800 16.6%,#ffee00 33.3%,#00cc44 50%,#0088ff 66.6%,#3322cc 83.3%,#9900cc 100%)",
            border: "1px solid var(--border)",
          }}
        />
      )}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={gradientToTransparent}
          onChange={(e) => setGradientToTransparent(e.target.checked)}
        />
        終点を透明にする
      </label>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        {isRainbow
          ? "色は虹色プリセットを使います（前景/背景色は無視）"
          : "キャンバスをドラッグして方向を決定"}
      </div>
    </div>
  );
}

export function ShapeOptions({
  shapeKind,
  setShapeKind,
  shapeFill,
  setShapeFill,
  shapeStroke,
  setShapeStroke,
  shapeStrokeWidth,
  setShapeStrokeWidth,
}: ShapeOptionsProps) {
  return (
    <div className="section">
      <div className="section-title">図形</div>
      <div className="tabs-grid">
        {chunk(SHAPE_OPTIONS, 2).map((row, i) => (
          <Tabs
            key={i}
            value={shapeKind}
            onChange={setShapeKind}
            options={row}
          />
        ))}
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={shapeFill}
          onChange={(e) => setShapeFill(e.target.checked)}
        />
        塗り（前景色）
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={shapeStroke}
          onChange={(e) => setShapeStroke(e.target.checked)}
        />
        枠線（背景色）
      </label>
      {shapeStroke && (
        <Slider
          label="枠線"
          value={shapeStrokeWidth}
          min={1}
          max={20}
          onChange={setShapeStrokeWidth}
          format={(v) => `${v}px`}
        />
      )}
    </div>
  );
}

export function BlurOptions({ blurRadius, setBlurRadius }: BlurOptionsProps) {
  return (
    <div className="section">
      <div className="section-title">ぼかし</div>
      <Slider
        label="半径"
        value={blurRadius}
        min={1}
        max={64}
        onChange={setBlurRadius}
        format={(v) => `${v}px`}
      />
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        キャンバスをクリックで適用（選択範囲があればその範囲に）
      </div>
    </div>
  );
}

export function TextToolOptions() {
  return (
    <div className="section">
      <div className="section-title">テキスト</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
        キャンバスをクリックでテキストレイヤーを追加します。
        配置後、右パネルのテキスト編集で内容・フォント・サイズを変更できます。
      </div>
    </div>
  );
}

export function LayerPickOptions() {
  return (
    <div className="section">
      <div className="section-title">レイヤー選択</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
        キャンバスをクリックした位置にピクセルがある最上位のレイヤーをアクティブにします。
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        透明部分や非表示レイヤーはスキップされます。グループは対象外です。
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
