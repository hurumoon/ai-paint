import type { MutableRefObject } from "react";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { PressureCurve } from "../../core/pressureCurve";
import type { Timelapse } from "../../core/Timelapse";
import type {
  AIGuideDisplayMode,
  BrushKind,
  CanvasExtendPreview,
  EraserKind,
  GradientKind,
  GradientPreset,
  GuideShape,
  MoveMode,
  SelectKind,
  Selection,
  ShapeKind,
  ShortcutMap,
  TextLayerData,
  Tool,
} from "../../types";
import type { GridConfig } from "../GridSettings";

export interface CanvasDocumentState {
  doc: PaintDocument;
  version: number;
  history: History;
  timelapse: Timelapse;
}

export interface CanvasToolState {
  tool: Tool;
  color: string;
  secondaryColor: string;
  brushSize: number;
  brushOpacity: number;
  brushKind: BrushKind;
  eraserKind: EraserKind;
  stabilizer: number;
  pressureSize: number;
  pressureOpacity: number;
  antiAliasStrength: number;
  gradientKind: GradientKind;
  gradientToTransparent: boolean;
  gradientPreset: GradientPreset;
  shapeKind: ShapeKind;
  shapeFill: boolean;
  shapeStroke: boolean;
  shapeStrokeWidth: number;
  blurRadius: number;
  bucketTolerance: number;
  bucketGapClose: number;
  bucketExpand: number;
  selectKind: SelectKind;
  moveMode: MoveMode;
  magicTolerance: number;
  magicContiguous: boolean;
  magicSampleAllLayers: boolean;
  eyedropperSampleAllLayers: boolean;
  pressureCurve: PressureCurve;
  customBrushId: string | null;
  selection: Selection;
  setSelection: (selection: Selection) => void;
}

export interface CanvasViewState {
  zoom: number;
  setZoom: (zoom: number) => void;
  pan: { x: number; y: number };
  setPan: (pan: { x: number; y: number }) => void;
  rotation: number;
  canvasFlipped: boolean;
  grid: GridConfig;
  // パン用ボタン判定で view.pan アクションを参照する。
  shortcuts: ShortcutMap;
  // ファイル読み込み中は Space とポインター割り当てによるパンも開始しない。
  isFileLoading: () => boolean;
}

export interface CanvasOverlayState {
  replayFrame?: import("../../core/agent/recording").DrawingAgentPreviewFrame;
  guides: GuideShape[];
  showGuides: boolean;
  aiGuideDisplayMode: AIGuideDisplayMode;
  highlightGuide: GuideShape | null;
  canvasExtendPreview: CanvasExtendPreview | null;
}

export interface CanvasDocumentIO {
  onPickColor: (hex: string) => void;
  defaultTextStyle: TextLayerData;
  onTextLayerCreated: (layerId: string) => void;
  // Canvas がストローク開始/終了に合わせて更新し、保存など外側の操作が描画中判定に使う。
  paintBusyRef: MutableRefObject<boolean>;
  // AI 送信中に描画/編集系の canvas 入力を始めないための同期 getter。
  isAIProcessingBusy?: () => boolean;
  // AutoBackup 保存中に書き込み系ツールを始めないための同期 getter。
  isAutoBackupBusy?: () => boolean;
}

export interface CanvasProps {
  documentState: CanvasDocumentState;
  toolState: CanvasToolState;
  viewState: CanvasViewState;
  overlayState: CanvasOverlayState;
  documentIO: CanvasDocumentIO;
}
