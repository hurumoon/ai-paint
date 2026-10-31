import { PixelLayer } from "../../core/PaintDocument";
import { BlendMode } from "../../types";
import { Slider } from "../../ui/primitives";

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "通常" },
  { value: "multiply", label: "乗算" },
  { value: "screen", label: "スクリーン" },
  { value: "overlay", label: "オーバーレイ" },
  { value: "darken", label: "比較（暗）" },
  { value: "lighten", label: "比較（明）" },
  { value: "color-dodge", label: "覆い焼き" },
  { value: "color-burn", label: "焼き込み" },
  { value: "linear-dodge", label: "加算（発光）" },
  { value: "subtract", label: "減算" },
  { value: "soft-light", label: "ソフトライト" },
  { value: "difference", label: "差の絶対値" },
  { value: "color", label: "カラー" },
  { value: "luminosity", label: "輝度" },
];

interface Props {
  active: PixelLayer | undefined;
  onChangeOpacity: (layerId: string, opacity: number) => void;
  onChangeBlendMode: (layerId: string, blendMode: BlendMode) => void;
}

export function ActiveLayerControls({
  active,
  onChangeOpacity,
  onChangeBlendMode,
}: Props) {
  if (!active) return null;

  return (
    <>
      {/* 不透明度・ブレンドモードはスライダー/セレクトの連続変更を履歴対象外にする
          （都度フルスナップショットを取ると数十MBの履歴を量産するため） */}
      <Slider
        label="不透明"
        value={Math.round(active.meta.opacity * 100)}
        min={0}
        max={100}
        onChange={(v) => onChangeOpacity(active.meta.id, v / 100)}
        format={(v) => `${v}%`}
      />
      <select
        className="select"
        data-testid="layer-blend-mode-select"
        value={active.meta.blendMode}
        onChange={(e) =>
          onChangeBlendMode(active.meta.id, e.target.value as BlendMode)
        }
      >
        {BLEND_MODES.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
    </>
  );
}
