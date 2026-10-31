import {
  BrushKind,
  BrushCategory,
  EraserKind,
  GradientKind,
  GradientPreset,
  MoveMode,
  SelectKind,
  Selection,
  ShapeKind,
  Tool,
} from "../types";
import { PressureCurve } from "../core/pressureCurve";
import { ColorHistory } from "./ColorHistory";
import { ColorHistoryConfig } from "../core/colorHistory";
import {
  BrushOptions,
  EraserOptions,
} from "./toolOptions/BrushEraserOptions";
import {
  BlurOptions,
  BucketOptions,
  GradientOptions,
  LayerPickOptions,
  ShapeOptions,
  TextToolOptions,
} from "./toolOptions/PaintToolOptions";
import {
  EyedropperOptions,
  MoveOptions,
  SelectOptions,
} from "./toolOptions/SelectionUtilityOptions";

export interface ToolOptionsProps {
  tool: Tool;
  // 色・サイズ・不透明（ブラシ/消しゴム共通の主要パラメータ）
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
  eraserKind: EraserKind;
  setEraserKind: (k: EraserKind) => void;
  gradientKind: GradientKind;
  setGradientKind: (k: GradientKind) => void;
  gradientToTransparent: boolean;
  setGradientToTransparent: (b: boolean) => void;
  gradientPreset: GradientPreset;
  setGradientPreset: (p: GradientPreset) => void;
  shapeKind: ShapeKind;
  setShapeKind: (k: ShapeKind) => void;
  shapeFill: boolean;
  setShapeFill: (b: boolean) => void;
  shapeStroke: boolean;
  setShapeStroke: (b: boolean) => void;
  shapeStrokeWidth: number;
  setShapeStrokeWidth: (n: number) => void;
  blurRadius: number;
  setBlurRadius: (n: number) => void;
  // 手振れ補正
  stabilizer: number;
  setStabilizer: (n: number) => void;
  // 筆圧感度
  pressureSize: number;
  setPressureSize: (n: number) => void;
  pressureOpacity: number;
  setPressureOpacity: (n: number) => void;
  // 筆圧カーブ
  pressureCurve: PressureCurve;
  setPressureCurve: (c: PressureCurve) => void;
  antiAliasStrength: number;
  setAntiAliasStrength: (n: number) => void;
  // カスタムブラシ
  customBrushId: string | null;
  setCustomBrushId: (id: string | null) => void;
  // 範囲指定
  selectKind: SelectKind;
  setSelectKind: (k: SelectKind) => void;
  // 移動ツールのサブモード (レイヤー移動 / キャンバスパン)
  moveMode: MoveMode;
  setMoveMode: (m: MoveMode) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  magicTolerance: number;
  setMagicTolerance: (n: number) => void;
  magicContiguous: boolean;
  setMagicContiguous: (b: boolean) => void;
  magicSampleAllLayers: boolean;
  setMagicSampleAllLayers: (b: boolean) => void;
  // スポイト
  eyedropperSampleAllLayers: boolean;
  setEyedropperSampleAllLayers: (b: boolean) => void;
  // バケツ
  bucketTolerance: number;
  setBucketTolerance: (n: number) => void;
  bucketGapClose: number;
  setBucketGapClose: (n: number) => void;
  bucketExpand: number;
  setBucketExpand: (n: number) => void;
  // カラー履歴
  colorHistory: string[];
  colorHistoryConfig: ColorHistoryConfig;
}

export function ToolOptions(props: ToolOptionsProps) {
  // 色を使うツールで表示する色履歴サブセクション。
  // 設定でオフなら何も描画しない。
  const colorHistorySection = props.colorHistoryConfig.enabled ? (
    <ColorHistory
      colors={props.colorHistory}
      display={props.colorHistoryConfig.display}
      currentColor={props.color}
      onPick={props.setColor}
    />
  ) : null;

  if (props.tool === "brush") {
    return (
      <BrushOptions
        color={props.color}
        setColor={props.setColor}
        secondaryColor={props.secondaryColor}
        setSecondaryColor={props.setSecondaryColor}
        brushSize={props.brushSize}
        setBrushSize={props.setBrushSize}
        brushOpacity={props.brushOpacity}
        setBrushOpacity={props.setBrushOpacity}
        brushCategory={props.brushCategory}
        setBrushCategory={props.setBrushCategory}
        brushKind={props.brushKind}
        setBrushKind={props.setBrushKind}
        pressureSize={props.pressureSize}
        setPressureSize={props.setPressureSize}
        pressureOpacity={props.pressureOpacity}
        setPressureOpacity={props.setPressureOpacity}
        pressureCurve={props.pressureCurve}
        setPressureCurve={props.setPressureCurve}
        antiAliasStrength={props.antiAliasStrength}
        setAntiAliasStrength={props.setAntiAliasStrength}
        customBrushId={props.customBrushId}
        setCustomBrushId={props.setCustomBrushId}
        stabilizer={props.stabilizer}
        setStabilizer={props.setStabilizer}
        colorHistorySection={colorHistorySection}
      />
    );
  }
  if (props.tool === "eraser") {
    return (
      <EraserOptions
        brushSize={props.brushSize}
        setBrushSize={props.setBrushSize}
        brushOpacity={props.brushOpacity}
        setBrushOpacity={props.setBrushOpacity}
        eraserKind={props.eraserKind}
        setEraserKind={props.setEraserKind}
        pressureSize={props.pressureSize}
        setPressureSize={props.setPressureSize}
        pressureOpacity={props.pressureOpacity}
        setPressureOpacity={props.setPressureOpacity}
        pressureCurve={props.pressureCurve}
        setPressureCurve={props.setPressureCurve}
      />
    );
  }
  if (props.tool === "select") {
    return (
      <SelectOptions
        selectKind={props.selectKind}
        setSelectKind={props.setSelectKind}
        selection={props.selection}
        setSelection={props.setSelection}
        magicTolerance={props.magicTolerance}
        setMagicTolerance={props.setMagicTolerance}
        magicContiguous={props.magicContiguous}
        setMagicContiguous={props.setMagicContiguous}
        magicSampleAllLayers={props.magicSampleAllLayers}
        setMagicSampleAllLayers={props.setMagicSampleAllLayers}
      />
    );
  }
  if (props.tool === "move") {
    return (
      <MoveOptions
        moveMode={props.moveMode}
        setMoveMode={props.setMoveMode}
        selection={props.selection}
      />
    );
  }
  if (props.tool === "eyedropper") {
    return (
      <EyedropperOptions
        eyedropperSampleAllLayers={props.eyedropperSampleAllLayers}
        setEyedropperSampleAllLayers={props.setEyedropperSampleAllLayers}
      />
    );
  }
  if (props.tool === "bucket") {
    return (
      <BucketOptions
        color={props.color}
        setColor={props.setColor}
        secondaryColor={props.secondaryColor}
        setSecondaryColor={props.setSecondaryColor}
        bucketTolerance={props.bucketTolerance}
        setBucketTolerance={props.setBucketTolerance}
        bucketGapClose={props.bucketGapClose}
        setBucketGapClose={props.setBucketGapClose}
        bucketExpand={props.bucketExpand}
        setBucketExpand={props.setBucketExpand}
        colorHistorySection={colorHistorySection}
      />
    );
  }
  if (props.tool === "gradient") {
    return (
      <GradientOptions
        gradientKind={props.gradientKind}
        setGradientKind={props.setGradientKind}
        gradientToTransparent={props.gradientToTransparent}
        setGradientToTransparent={props.setGradientToTransparent}
        gradientPreset={props.gradientPreset}
        setGradientPreset={props.setGradientPreset}
      />
    );
  }
  if (props.tool === "shape") {
    return (
      <ShapeOptions
        shapeKind={props.shapeKind}
        setShapeKind={props.setShapeKind}
        shapeFill={props.shapeFill}
        setShapeFill={props.setShapeFill}
        shapeStroke={props.shapeStroke}
        setShapeStroke={props.setShapeStroke}
        shapeStrokeWidth={props.shapeStrokeWidth}
        setShapeStrokeWidth={props.setShapeStrokeWidth}
      />
    );
  }
  if (props.tool === "blur") {
    return (
      <BlurOptions
        blurRadius={props.blurRadius}
        setBlurRadius={props.setBlurRadius}
      />
    );
  }
  if (props.tool === "text") {
    return <TextToolOptions />;
  }
  if (props.tool === "layerPick") {
    return <LayerPickOptions />;
  }
  return null;
}
