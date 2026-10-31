import { Slider } from "../../ui/primitives";
import type { ColorAdjustMode, CurvePoint } from "./ColorAdjustTypes";
import { CurveEditor } from "./CurveEditor";
import { HistogramView } from "./HistogramView";
import { QuickFilterControls } from "./QuickFilterControls";

export { COLOR_ADJUST_TABS, CURVE_DEFAULT } from "./ColorAdjustTypes";
export type { ColorAdjustMode, CurvePoint } from "./ColorAdjustTypes";

interface ColorAdjustControlsProps {
  mode: ColorAdjustMode;
  brightness: number;
  contrast: number;
  hueShift: number;
  satScale: number;
  lightAdd: number;
  inBlack: number;
  inGamma: number;
  inWhite: number;
  outBlack: number;
  outWhite: number;
  curvePoints: CurvePoint[];
  histogram: Uint32Array | null;
  onBrightnessChange: (value: number) => void;
  onContrastChange: (value: number) => void;
  onHueShiftChange: (value: number) => void;
  onSatScaleChange: (value: number) => void;
  onLightAddChange: (value: number) => void;
  onInBlackChange: (value: number) => void;
  onInGammaChange: (value: number) => void;
  onInWhiteChange: (value: number) => void;
  onOutBlackChange: (value: number) => void;
  onOutWhiteChange: (value: number) => void;
  onCurvePointsChange: (points: CurvePoint[]) => void;
  onQuickFilter: (kind: "invert" | "grayscale" | "sepia", label: string) => void;
}

export function ColorAdjustControls({
  mode,
  brightness,
  contrast,
  hueShift,
  satScale,
  lightAdd,
  inBlack,
  inGamma,
  inWhite,
  outBlack,
  outWhite,
  curvePoints,
  histogram,
  onBrightnessChange,
  onContrastChange,
  onHueShiftChange,
  onSatScaleChange,
  onLightAddChange,
  onInBlackChange,
  onInGammaChange,
  onInWhiteChange,
  onOutBlackChange,
  onOutWhiteChange,
  onCurvePointsChange,
  onQuickFilter,
}: ColorAdjustControlsProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 200,
      }}
    >
      {mode === "bc" && (
        <>
          <Slider
            label="明度"
            value={brightness}
            min={-100}
            max={100}
            onChange={onBrightnessChange}
          />
          <Slider
            label="コントラスト"
            value={contrast}
            min={-100}
            max={100}
            onChange={onContrastChange}
          />
        </>
      )}

      {mode === "hsl" && (
        <>
          <Slider
            label="色相 (°)"
            value={hueShift}
            min={-180}
            max={180}
            onChange={onHueShiftChange}
          />
          <Slider
            label="彩度"
            value={satScale}
            min={-100}
            max={100}
            onChange={onSatScaleChange}
          />
          <Slider
            label="明度"
            value={lightAdd}
            min={-100}
            max={100}
            onChange={onLightAddChange}
          />
        </>
      )}

      {mode === "levels" && (
        <>
          {histogram && (
            <HistogramView
              hist={histogram}
              inBlack={inBlack}
              inWhite={inWhite}
            />
          )}
          {/* min/max は 0..255 固定。入力黒>=入力白 などの不正値は
              buildLevelsLUT 側のクランプで安全に処理されるので、
              スライダー側でレンジを動的に潰さない (潰すと相手の値を
              下げた時 max=0 に縮んで戻せなくなる罠がある)。 */}
          <Slider
            label="入力 黒"
            value={inBlack}
            min={0}
            max={255}
            onChange={onInBlackChange}
          />
          <Slider
            label="入力 ガンマ"
            value={inGamma}
            min={0.1}
            max={3}
            step={0.01}
            onChange={onInGammaChange}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="入力 白"
            value={inWhite}
            min={0}
            max={255}
            onChange={onInWhiteChange}
          />
          <Slider
            label="出力 黒"
            value={outBlack}
            min={0}
            max={255}
            onChange={onOutBlackChange}
          />
          <Slider
            label="出力 白"
            value={outWhite}
            min={0}
            max={255}
            onChange={onOutWhiteChange}
          />
        </>
      )}

      {mode === "curves" && (
        <CurveEditor points={curvePoints} onChange={onCurvePointsChange} />
      )}

      {mode === "quick" && <QuickFilterControls onQuickFilter={onQuickFilter} />}
    </div>
  );
}
