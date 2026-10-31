import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { BrushCategory, BrushKind, EraserKind } from "../../types";
import { drawBrushPreview } from "../../core/brushPreview";
import type { PressureCurve } from "../../core/pressureCurve";
import {
  BRUSH_CATEGORIES,
  BRUSH_CATEGORY_OPTIONS,
} from "../../core/brushCategories";
import { ColorSwatch, Slider, Tabs } from "../../ui/primitives";
import { CustomBrushPanel } from "../CustomBrushPanel";
import { PressureCurveEditor } from "../PressureCurveEditor";

const ERASER_OPTIONS: { value: EraserKind; label: string }[] = [
  { value: "round", label: "丸" },
  { value: "hard", label: "ハード" },
  { value: "soft", label: "ソフト" },
];

const ANTIALIASED_BRUSH_KINDS = new Set<BrushKind>([
  "pen",
  "fountainPen",
  "gPen",
  "maruPen",
]);

const BRUSH_PREVIEW_WIDTH = 96;
const BRUSH_PREVIEW_HEIGHT = 32;
const BRUSH_PREVIEW_COLOR_DEBOUNCE_MS = 120;
const ERASER_PREVIEW_COLOR = "#4f7cff";

interface BrushOptionsProps {
  color: string;
  setColor: (c: string) => void;
  secondaryColor: string;
  setSecondaryColor: (c: string) => void;
  brushSize: number;
  setBrushSize: (n: number) => void;
  brushOpacity: number;
  setBrushOpacity: (n: number) => void;
  brushCategory: BrushCategory;
  setBrushCategory: (c: BrushCategory) => void;
  brushKind: BrushKind;
  setBrushKind: (k: BrushKind) => void;
  pressureSize: number;
  setPressureSize: (n: number) => void;
  pressureOpacity: number;
  setPressureOpacity: (n: number) => void;
  pressureCurve: PressureCurve;
  setPressureCurve: (c: PressureCurve) => void;
  antiAliasStrength: number;
  setAntiAliasStrength: (n: number) => void;
  customBrushId: string | null;
  setCustomBrushId: (id: string | null) => void;
  stabilizer: number;
  setStabilizer: (n: number) => void;
  colorHistorySection: ReactNode;
}

interface EraserOptionsProps {
  brushSize: number;
  setBrushSize: (n: number) => void;
  brushOpacity: number;
  setBrushOpacity: (n: number) => void;
  eraserKind: EraserKind;
  setEraserKind: (k: EraserKind) => void;
  pressureSize: number;
  setPressureSize: (n: number) => void;
  pressureOpacity: number;
  setPressureOpacity: (n: number) => void;
  pressureCurve: PressureCurve;
  setPressureCurve: (c: PressureCurve) => void;
}

export function BrushOptions({
  color,
  setColor,
  secondaryColor,
  setSecondaryColor,
  brushSize,
  setBrushSize,
  brushOpacity,
  setBrushOpacity,
  brushCategory,
  setBrushCategory,
  brushKind,
  setBrushKind,
  pressureSize,
  setPressureSize,
  pressureOpacity,
  setPressureOpacity,
  pressureCurve,
  setPressureCurve,
  antiAliasStrength,
  setAntiAliasStrength,
  customBrushId,
  setCustomBrushId,
  stabilizer,
  setStabilizer,
  colorHistorySection,
}: BrushOptionsProps) {
  const previewColor = useDebouncedValue(
    color,
    BRUSH_PREVIEW_COLOR_DEBOUNCE_MS
  );

  return (
    <>
      <div className="section">
        <div className="section-title">色・サイズ</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ColorSwatch color={color} onChange={setColor} size="large" />
          <ColorSwatch
            color={secondaryColor}
            onChange={setSecondaryColor}
          />
        </div>
        {colorHistorySection}
        <Slider
          label="サイズ"
          value={brushSize}
          min={1}
          max={200}
          onChange={setBrushSize}
          format={(v) => `${v}px`}
        />
        <Slider
          label="不透明"
          value={Math.round(brushOpacity * 100)}
          min={0}
          max={100}
          onChange={(v) => setBrushOpacity(v / 100)}
          format={(v) => `${v}%`}
        />
      </div>
      <div className="section">
        <div className="section-title">ブラシ系統</div>
        <div className="tabs-grid">
          {chunk(BRUSH_CATEGORIES, 2).map((row, i) => (
            <Tabs
              key={i}
              value={brushCategory}
              onChange={setBrushCategory}
              options={row}
            />
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-title">ブラシ種別</div>
        <BrushKindPicker
          options={BRUSH_CATEGORY_OPTIONS[brushCategory]}
          value={brushKind}
          onChange={setBrushKind}
          brushSize={brushSize}
          brushOpacity={brushOpacity}
          pressureSize={pressureSize}
          pressureOpacity={pressureOpacity}
          pressureCurve={pressureCurve}
          antiAliasStrength={antiAliasStrength}
          previewColor={previewColor}
        />
      </div>
      {brushKind === "custom" && (
        <div className="section">
          <div className="section-title">カスタムブラシ</div>
          <CustomBrushPanel
            selectedId={customBrushId}
            onSelect={setCustomBrushId}
          />
        </div>
      )}
      {ANTIALIASED_BRUSH_KINDS.has(brushKind) && (
        <div className="section">
          <div className="section-title">アンチエイリアス</div>
          <Slider
            label="強さ"
            value={Math.round(antiAliasStrength * 100)}
            min={0}
            max={100}
            onChange={(v) => setAntiAliasStrength(v / 100)}
            format={(v) => `${v}%`}
          />
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
            50%で標準。0%で硬いフチ、100%でなめらかなフチ
          </div>
        </div>
      )}
      <PressureSensitivityOptions
        pressureSize={pressureSize}
        setPressureSize={setPressureSize}
        pressureOpacity={pressureOpacity}
        setPressureOpacity={setPressureOpacity}
        showHint
      />
      <div className="section">
        <div className="section-title">筆圧カーブ</div>
        <PressureCurveEditor
          curve={pressureCurve}
          onChange={setPressureCurve}
        />
      </div>
      <div className="section">
        <div className="section-title">手振れ補正</div>
        <Slider
          label="強度"
          value={Math.round(stabilizer * 100)}
          min={0}
          max={95}
          onChange={(v) => setStabilizer(v / 100)}
          format={(v) => `${v}%`}
        />
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          高いほど線が滑らかになり、追従が遅れます
        </div>
      </div>
    </>
  );
}

function BrushKindPicker({
  options,
  value,
  onChange,
  brushSize,
  brushOpacity,
  pressureSize,
  pressureOpacity,
  pressureCurve,
  antiAliasStrength,
  previewColor,
}: {
  options: { value: BrushKind; label: string }[];
  value: BrushKind;
  onChange: (kind: BrushKind) => void;
  brushSize: number;
  brushOpacity: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
  antiAliasStrength: number;
  previewColor: string;
}) {
  return (
    <div className="brush-preview-grid">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`brush-preview-option ${
            value === option.value ? "active" : ""
          }`}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          <span className="brush-preview-swatch" aria-hidden="true">
            <BrushPreviewCanvas
              kind={option.value}
              color={previewColor}
              brushSize={brushSize}
              brushOpacity={brushOpacity}
              pressureSize={pressureSize}
              pressureOpacity={pressureOpacity}
              pressureCurve={pressureCurve}
              antiAliasStrength={antiAliasStrength}
            />
          </span>
          <span className="brush-preview-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

interface BrushPreviewCanvasBaseProps {
  color: string;
  brushSize: number;
  brushOpacity: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
  antiAliasStrength: number;
}

type BrushPreviewCanvasProps =
  | (BrushPreviewCanvasBaseProps & {
      tool?: "brush";
      kind: BrushKind;
    })
  | (BrushPreviewCanvasBaseProps & {
      tool: "eraser";
      kind: EraserKind;
    });

const BrushPreviewCanvas = memo(function BrushPreviewCanvas(
  props: BrushPreviewCanvasProps
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(BRUSH_PREVIEW_WIDTH * dpr);
    canvas.height = Math.round(BRUSH_PREVIEW_HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const commonOptions = {
      width: BRUSH_PREVIEW_WIDTH,
      height: BRUSH_PREVIEW_HEIGHT,
      color: props.color,
      size: props.brushSize,
      opacity: props.brushOpacity,
      pressureSize: props.pressureSize,
      pressureOpacity: props.pressureOpacity,
      pressureCurve: props.pressureCurve,
      antiAliasStrength: props.antiAliasStrength,
    };
    if (props.tool === "eraser") {
      drawBrushPreview(ctx, {
        ...commonOptions,
        tool: "eraser",
        kind: props.kind,
      });
      return;
    }
    drawBrushPreview(ctx, {
      ...commonOptions,
      tool: "brush",
      kind: props.kind,
    });
  }, [
    props.antiAliasStrength,
    props.brushOpacity,
    props.brushSize,
    props.color,
    props.kind,
    props.pressureCurve,
    props.pressureOpacity,
    props.pressureSize,
    props.tool,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="brush-preview-canvas"
      width={BRUSH_PREVIEW_WIDTH}
      height={BRUSH_PREVIEW_HEIGHT}
    />
  );
});

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debounced;
}

export function EraserOptions({
  brushSize,
  setBrushSize,
  brushOpacity,
  setBrushOpacity,
  eraserKind,
  setEraserKind,
  pressureSize,
  setPressureSize,
  pressureOpacity,
  setPressureOpacity,
  pressureCurve,
  setPressureCurve,
}: EraserOptionsProps) {
  return (
    <>
      <div className="section">
        <div className="section-title">サイズ・不透明</div>
        <Slider
          label="サイズ"
          value={brushSize}
          min={1}
          max={200}
          onChange={setBrushSize}
          format={(v) => `${v}px`}
        />
        <Slider
          label="不透明"
          value={Math.round(brushOpacity * 100)}
          min={0}
          max={100}
          onChange={(v) => setBrushOpacity(v / 100)}
          format={(v) => `${v}%`}
        />
      </div>
      <div className="section">
        <div className="section-title">消しゴム種別</div>
        <EraserKindPicker
          value={eraserKind}
          onChange={setEraserKind}
          brushSize={brushSize}
          brushOpacity={brushOpacity}
          pressureSize={pressureSize}
          pressureOpacity={pressureOpacity}
          pressureCurve={pressureCurve}
        />
      </div>
      <PressureSensitivityOptions
        pressureSize={pressureSize}
        setPressureSize={setPressureSize}
        pressureOpacity={pressureOpacity}
        setPressureOpacity={setPressureOpacity}
      />
      <div className="section">
        <div className="section-title">筆圧カーブ</div>
        <PressureCurveEditor
          curve={pressureCurve}
          onChange={setPressureCurve}
        />
      </div>
    </>
  );
}

function EraserKindPicker({
  value,
  onChange,
  brushSize,
  brushOpacity,
  pressureSize,
  pressureOpacity,
  pressureCurve,
}: {
  value: EraserKind;
  onChange: (kind: EraserKind) => void;
  brushSize: number;
  brushOpacity: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
}) {
  return (
    <div className="brush-preview-grid">
      {ERASER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`brush-preview-option ${
            value === option.value ? "active" : ""
          }`}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          <span className="brush-preview-swatch" aria-hidden="true">
            <BrushPreviewCanvas
              tool="eraser"
              kind={option.value}
              color={ERASER_PREVIEW_COLOR}
              brushSize={brushSize}
              brushOpacity={brushOpacity}
              pressureSize={pressureSize}
              pressureOpacity={pressureOpacity}
              pressureCurve={pressureCurve}
              antiAliasStrength={1}
            />
          </span>
          <span className="brush-preview-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PressureSensitivityOptions({
  pressureSize,
  setPressureSize,
  pressureOpacity,
  setPressureOpacity,
  showHint = false,
}: {
  pressureSize: number;
  setPressureSize: (n: number) => void;
  pressureOpacity: number;
  setPressureOpacity: (n: number) => void;
  showHint?: boolean;
}) {
  return (
    <div className="section">
      <div className="section-title">筆圧感度</div>
      <Slider
        label="サイズ"
        value={Math.round(pressureSize * 100)}
        min={0}
        max={100}
        onChange={(v) => setPressureSize(v / 100)}
        format={(v) => `${v}%`}
      />
      <Slider
        label="不透明"
        value={Math.round(pressureOpacity * 100)}
        min={0}
        max={100}
        onChange={(v) => setPressureOpacity(v / 100)}
        format={(v) => `${v}%`}
      />
      {showHint && (
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          ペン/タッチ時のみ反映。0%で筆圧無効
        </div>
      )}
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
