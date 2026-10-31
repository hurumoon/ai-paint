import type { MoveMode, SelectKind, Selection } from "../../types";
import { Slider, Tabs } from "../../ui/primitives";

const SELECT_OPTIONS: { value: SelectKind; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "polygon", label: "多角形" },
  { value: "magic", label: "自動" },
];

const MOVE_OPTIONS: { value: MoveMode; label: string }[] = [
  { value: "layer", label: "移動" },
  { value: "scale", label: "拡縮" },
  { value: "rotate", label: "回転" },
  { value: "free", label: "自由" },
  { value: "canvas", label: "キャンバス" },
];

interface SelectOptionsProps {
  selectKind: SelectKind;
  setSelectKind: (k: SelectKind) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  magicTolerance: number;
  setMagicTolerance: (n: number) => void;
  magicContiguous: boolean;
  setMagicContiguous: (b: boolean) => void;
  magicSampleAllLayers: boolean;
  setMagicSampleAllLayers: (b: boolean) => void;
}

interface MoveOptionsProps {
  moveMode: MoveMode;
  setMoveMode: (m: MoveMode) => void;
  selection: Selection;
}

interface EyedropperOptionsProps {
  eyedropperSampleAllLayers: boolean;
  setEyedropperSampleAllLayers: (b: boolean) => void;
}

export function SelectOptions({
  selectKind,
  setSelectKind,
  selection,
  setSelection,
  magicTolerance,
  setMagicTolerance,
  magicContiguous,
  setMagicContiguous,
  magicSampleAllLayers,
  setMagicSampleAllLayers,
}: SelectOptionsProps) {
  return (
    <div className="section">
      <div className="section-title">
        範囲指定
        {selection.kind !== "none" && (
          <button
            className="btn ghost"
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => setSelection({ kind: "none" })}
            title="選択範囲を解除 (Esc)"
          >
            解除
          </button>
        )}
      </div>
      <div className="tabs-grid">
        {chunk(SELECT_OPTIONS, 2).map((row, i) => (
          <Tabs
            key={i}
            value={selectKind}
            onChange={setSelectKind}
            options={row}
          />
        ))}
      </div>
      {selectKind === "magic" && (
        <>
          <Slider
            label="許容差"
            value={magicTolerance}
            min={0}
            max={255}
            onChange={setMagicTolerance}
            format={(v) => `${v}`}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            <input
              type="checkbox"
              checked={magicContiguous}
              onChange={(e) => setMagicContiguous(e.target.checked)}
            />
            連続する領域のみ
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            <input
              type="checkbox"
              checked={magicSampleAllLayers}
              onChange={(e) => setMagicSampleAllLayers(e.target.checked)}
            />
            全レイヤーからサンプル
          </label>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
            連続OFFで色域全体を選択 (色相選択モード)
          </div>
        </>
      )}
      {selectKind === "polygon" && (
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          クリックで頂点を追加 / ダブルクリックで閉じる / Escapeで中断
        </div>
      )}
    </div>
  );
}

export function MoveOptions({ moveMode, setMoveMode, selection }: MoveOptionsProps) {
  const hasSelection = selection.kind !== "none";
  return (
    <div className="section">
      <div className="section-title">移動モード</div>
      <div className="tabs-grid">
        {chunk(MOVE_OPTIONS, 2).map((row, i) => (
          <Tabs
            key={i}
            value={moveMode}
            onChange={setMoveMode}
            options={row}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        {moveMode === "layer" &&
          "ドラッグでアクティブレイヤー、または選択範囲の中身を平行移動します。"}
        {moveMode === "scale" &&
          (hasSelection
            ? "選択範囲の中心からドラッグ距離に合わせて等倍で拡大縮小します。"
            : "拡縮には選択範囲が必要です。")}
        {moveMode === "rotate" &&
          (hasSelection
            ? "選択範囲の中心を軸に、ドラッグ角度に合わせて回転します。"
            : "回転には選択範囲が必要です。")}
        {moveMode === "free" &&
          (hasSelection
            ? "選択範囲の中心を基準に、横と縦を独立して拡大縮小します。"
            : "自由変形には選択範囲が必要です。")}
        {moveMode === "canvas" &&
          "ドラッグでビュー位置を動かします。キャンバス自体は変化しません。"}
      </div>
    </div>
  );
}

export function EyedropperOptions({
  eyedropperSampleAllLayers,
  setEyedropperSampleAllLayers,
}: EyedropperOptionsProps) {
  return (
    <div className="section">
      <div className="section-title">スポイト</div>
      <Tabs
        value={eyedropperSampleAllLayers ? "composite" : "active"}
        onChange={(v) =>
          setEyedropperSampleAllLayers(v === "composite")
        }
        options={[
          { value: "composite", label: "表示色" },
          { value: "active", label: "レイヤー色" },
        ]}
      />
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        表示色: 全レイヤーを合成した結果からピック / レイヤー色:
        アクティブレイヤーのピクセルからピック (透明部分は無視)
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
