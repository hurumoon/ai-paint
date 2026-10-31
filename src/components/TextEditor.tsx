import { useEffect, useState } from "react";
import { TextLayerData } from "../types";
import { Button, ColorSwatch, Slider } from "../ui/primitives";

interface Props {
  text: TextLayerData;
  canvasWidth: number;
  canvasHeight: number;
  onChange: (patch: Partial<TextLayerData>) => void;
  onDelete?: () => void;
}

const FONTS = [
  "sans-serif",
  "serif",
  "monospace",
  '"Hiragino Sans"',
  '"Yu Gothic UI"',
  '"Noto Sans JP"',
  '"Noto Serif JP"',
  "Arial",
  "Helvetica",
  "Georgia",
  "Courier New",
];

export function TextEditor({ text, canvasWidth, canvasHeight, onChange, onDelete }: Props) {
  const [local, setLocal] = useState(text);
  // text オブジェクトは毎レンダ新参照のため、中身を比較して差分があるときだけ同期
  const textKey = JSON.stringify(text);
  useEffect(() => {
    setLocal((prev) => (JSON.stringify(prev) === textKey ? prev : text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey]);

  const update = (patch: Partial<TextLayerData>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(patch);
  };

  return (
    <div className="section">
      <div className="section-title">テキスト編集</div>
      <textarea
        className="textarea"
        value={local.text}
        onChange={(e) => update({ text: e.target.value })}
        placeholder="文字を入力…"
        rows={3}
      />
      <select
        className="select"
        value={local.fontFamily}
        onChange={(e) => update({ fontFamily: e.target.value })}
      >
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f.replace(/"/g, "")}
          </option>
        ))}
      </select>
      <Slider
        label="サイズ"
        value={local.fontSize}
        min={8}
        max={400}
        onChange={(v) => update({ fontSize: v })}
        format={(v) => `${v}px`}
      />
      <Slider
        label="行間"
        value={Math.round(local.lineHeight * 100)}
        min={80}
        max={300}
        onChange={(v) => update({ lineHeight: v / 100 })}
        format={(v) => `${v}%`}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 28 }}>
          色
        </span>
        <ColorSwatch color={local.color} onChange={(c) => update({ color: c })} />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <input
            type="checkbox"
            checked={local.bold}
            onChange={(e) => update({ bold: e.target.checked })}
          />
          太字
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <input
            type="checkbox"
            checked={local.italic}
            onChange={(e) => update({ italic: e.target.checked })}
          />
          斜体
        </label>
      </div>
      <div className="tabs">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            className={`tab ${local.align === a ? "active" : ""}`}
            onClick={() => update({ align: a })}
          >
            {a === "left" ? "左" : a === "center" ? "中央" : "右"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Slider
          label="X"
          value={Math.round(local.x)}
          min={0}
          max={canvasWidth}
          onChange={(v) => update({ x: v })}
        />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Slider
          label="Y"
          value={Math.round(local.y)}
          min={0}
          max={canvasHeight}
          onChange={(v) => update({ y: v })}
        />
      </div>
      {onDelete && (
        <Button variant="danger" onClick={onDelete}>テキストレイヤー削除</Button>
      )}
    </div>
  );
}
