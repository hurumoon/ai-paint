import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasToolState } from "../components/canvas/types";
import type { ToolOptionsProps } from "../components/ToolOptions";
import {
  ColorHistoryConfig,
  loadColorHistory,
  loadColorHistoryConfig,
  pushColor,
  saveColorHistory,
  saveColorHistoryConfig,
} from "../core/colorHistory";
import { pushToast } from "../ui/primitives";
import {
  GradientKind,
  GradientPreset,
  MoveMode,
  SelectKind,
  Selection,
  ShapeKind,
  Tool,
} from "../types";
import { useBrushSettingsController } from "./useBrushSettingsController";

export type CanvasToolProps = CanvasToolState;

export function useToolState() {
  const [tool, setTool] = useState<Tool>("brush");
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  const [toolOptionsOpen, setToolOptionsOpen] = useState(false);
  const handleToolClick = useCallback(
    (next: Tool) => {
      if (next === tool) {
        setToolOptionsOpen((v) => !v);
      } else {
        setTool(next);
        setToolOptionsOpen(true);
      }
    },
    [tool]
  );

  const [color, setColor] = useState("#222222");
  const [secondaryColor, setSecondaryColor] = useState("#ffffff");
  const colorRef = useRef(color);
  const secondaryColorRef = useRef(secondaryColor);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    secondaryColorRef.current = secondaryColor;
  }, [secondaryColor]);

  const [colorHistoryConfig, setColorHistoryConfig] = useState<ColorHistoryConfig>(
    () => loadColorHistoryConfig()
  );
  useEffect(() => {
    saveColorHistoryConfig(colorHistoryConfig);
  }, [colorHistoryConfig]);

  const [colorHistory, setColorHistory] = useState<string[]>(() =>
    loadColorHistory()
  );
  useEffect(() => {
    setColorHistory((prev) => {
      if (prev.length <= colorHistoryConfig.maxCount) return prev;
      const next = prev.slice(0, colorHistoryConfig.maxCount);
      saveColorHistory(next);
      return next;
    });
  }, [colorHistoryConfig.maxCount]);
  useEffect(() => {
    const t = setTimeout(() => {
      setColorHistory((prev) => {
        const next = pushColor(prev, color, colorHistoryConfig.maxCount);
        if (next === prev) return prev;
        saveColorHistory(next);
        return next;
      });
    }, 350);
    return () => clearTimeout(t);
  }, [color, colorHistoryConfig.maxCount]);

  const handleClearColorHistory = useCallback(() => {
    setColorHistory([]);
    saveColorHistory([]);
    pushToast("カラー履歴をクリアしました", "info");
  }, []);

  const brushSettings = useBrushSettingsController();
  const {
    brushCategory,
    setBrushCategory,
  } = brushSettings;

  const handleBrushCategoryClick = useCallback(
    (next: typeof brushCategory) => {
      if (tool === "brush" && next === brushCategory) {
        setToolOptionsOpen((v) => !v);
        return;
      }
      setBrushCategory(next);
      setTool("brush");
      setToolOptionsOpen(true);
    },
    [brushCategory, setBrushCategory, tool]
  );

  const [gradientKind, setGradientKind] = useState<GradientKind>("linear");
  const [gradientToTransparent, setGradientToTransparent] = useState(true);
  const [gradientPreset, setGradientPreset] =
    useState<GradientPreset>("two-color");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [shapeFill, setShapeFill] = useState(true);
  const [shapeStroke, setShapeStroke] = useState(false);
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(2);
  const [blurRadius, setBlurRadius] = useState(8);
  const [bucketTolerance, setBucketTolerance] = useState(8);
  const [selectKind, setSelectKind] = useState<SelectKind>("rect");
  const [moveMode, setMoveMode] = useState<MoveMode>("layer");
  const [magicTolerance, setMagicTolerance] = useState(32);
  const [bucketGapClose, setBucketGapClose] = useState(0);
  const [bucketExpand, setBucketExpand] = useState(0);
  const [magicContiguous, setMagicContiguous] = useState(true);
  const [magicSampleAllLayers, setMagicSampleAllLayers] = useState(true);
  const [eyedropperSampleAllLayers, setEyedropperSampleAllLayers] =
    useState(true);

  return {
    tool,
    setTool,
    toolRef,
    toolOptionsOpen,
    setToolOptionsOpen,
    handleToolClick,
    color,
    setColor,
    colorRef,
    secondaryColor,
    setSecondaryColor,
    secondaryColorRef,
    colorHistory,
    colorHistoryConfig,
    setColorHistoryConfig,
    handleClearColorHistory,
    handleBrushCategoryClick,
    gradientKind,
    setGradientKind,
    gradientToTransparent,
    setGradientToTransparent,
    gradientPreset,
    setGradientPreset,
    shapeKind,
    setShapeKind,
    shapeFill,
    setShapeFill,
    shapeStroke,
    setShapeStroke,
    shapeStrokeWidth,
    setShapeStrokeWidth,
    blurRadius,
    setBlurRadius,
    bucketTolerance,
    setBucketTolerance,
    selectKind,
    setSelectKind,
    moveMode,
    setMoveMode,
    magicTolerance,
    setMagicTolerance,
    bucketGapClose,
    setBucketGapClose,
    bucketExpand,
    setBucketExpand,
    magicContiguous,
    setMagicContiguous,
    magicSampleAllLayers,
    setMagicSampleAllLayers,
    eyedropperSampleAllLayers,
    setEyedropperSampleAllLayers,
    ...brushSettings,
  };
}

export type ToolState = ReturnType<typeof useToolState>;

export function usePaintToolOptions(
  toolState: ToolState,
  selection: Selection,
  setSelection: (selection: Selection) => void
) {
  const {
    tool,
    color,
    setColor,
    secondaryColor,
    setSecondaryColor,
    colorHistory,
    colorHistoryConfig,
    brushCategory,
    setBrushCategory,
    activeBrushSettings,
    setBrushSize,
    setBrushOpacity,
    setBrushKind,
    setActivePressureSize,
    setActivePressureOpacity,
    setActivePressureCurve,
    setActiveAntiAliasStrength,
    setActiveStabilizer,
    setActiveCustomBrushId,
    eraserSize,
    setEraserSize,
    eraserOpacity,
    setEraserOpacity,
    eraserKind,
    setEraserKind,
    pressureSize,
    setPressureSize,
    pressureOpacity,
    setPressureOpacity,
    pressureCurve,
    setPressureCurve,
    gradientKind,
    setGradientKind,
    gradientToTransparent,
    setGradientToTransparent,
    gradientPreset,
    setGradientPreset,
    shapeKind,
    setShapeKind,
    shapeFill,
    setShapeFill,
    shapeStroke,
    setShapeStroke,
    shapeStrokeWidth,
    setShapeStrokeWidth,
    blurRadius,
    setBlurRadius,
    bucketTolerance,
    setBucketTolerance,
    bucketGapClose,
    setBucketGapClose,
    bucketExpand,
    setBucketExpand,
    selectKind,
    setSelectKind,
    moveMode,
    setMoveMode,
    magicTolerance,
    setMagicTolerance,
    magicContiguous,
    setMagicContiguous,
    magicSampleAllLayers,
    setMagicSampleAllLayers,
    eyedropperSampleAllLayers,
    setEyedropperSampleAllLayers,
  } = toolState;

  const brushSize = tool === "eraser" ? eraserSize : activeBrushSettings.size;
  const setActiveBrushSize = tool === "eraser" ? setEraserSize : setBrushSize;
  const brushOpacity =
    tool === "eraser" ? eraserOpacity : activeBrushSettings.opacity;
  const setActiveBrushOpacity =
    tool === "eraser" ? setEraserOpacity : setBrushOpacity;
  const activePressureSize =
    tool === "eraser" ? pressureSize : activeBrushSettings.pressureSize;
  const setActiveToolPressureSize =
    tool === "eraser" ? setPressureSize : setActivePressureSize;
  const activePressureOpacity =
    tool === "eraser" ? pressureOpacity : activeBrushSettings.pressureOpacity;
  const setActiveToolPressureOpacity =
    tool === "eraser" ? setPressureOpacity : setActivePressureOpacity;
  const activePressureCurve =
    tool === "eraser" ? pressureCurve : activeBrushSettings.pressureCurve;
  const setActiveToolPressureCurve =
    tool === "eraser" ? setPressureCurve : setActivePressureCurve;

  const canvasToolProps = useMemo<CanvasToolProps>(
    () => ({
      tool,
      color,
      secondaryColor,
      brushSize,
      brushOpacity,
      brushKind: activeBrushSettings.kind,
      eraserKind,
      stabilizer: activeBrushSettings.stabilizer,
      pressureSize: activePressureSize,
      pressureOpacity: activePressureOpacity,
      gradientKind,
      gradientToTransparent,
      gradientPreset,
      shapeKind,
      shapeFill,
      shapeStroke,
      shapeStrokeWidth,
      blurRadius,
      bucketTolerance,
      bucketGapClose,
      bucketExpand,
      selectKind,
      moveMode,
      magicTolerance,
      magicContiguous,
      magicSampleAllLayers,
      eyedropperSampleAllLayers,
      pressureCurve: activePressureCurve,
      antiAliasStrength: activeBrushSettings.antiAliasStrength,
      customBrushId: activeBrushSettings.customBrushId,
      selection,
      setSelection,
    }),
    [
      activeBrushSettings,
      activePressureCurve,
      activePressureOpacity,
      activePressureSize,
      blurRadius,
      brushOpacity,
      brushSize,
      bucketExpand,
      bucketGapClose,
      bucketTolerance,
      color,
      eraserKind,
      eyedropperSampleAllLayers,
      gradientKind,
      gradientPreset,
      gradientToTransparent,
      magicContiguous,
      magicSampleAllLayers,
      magicTolerance,
      moveMode,
      secondaryColor,
      selectKind,
      selection,
      setSelection,
      shapeFill,
      shapeKind,
      shapeStroke,
      shapeStrokeWidth,
      tool,
    ]
  );

  const toolOptionsProps = useMemo<ToolOptionsProps>(
    () => ({
      ...canvasToolProps,
      setColor,
      setSecondaryColor,
      setBrushSize: setActiveBrushSize,
      setBrushOpacity: setActiveBrushOpacity,
      brushCategory,
      setBrushCategory,
      setBrushKind,
      setEraserKind,
      setGradientKind,
      setGradientToTransparent,
      setGradientPreset,
      setShapeKind,
      setShapeFill,
      setShapeStroke,
      setShapeStrokeWidth,
      setBlurRadius,
      setStabilizer: setActiveStabilizer,
      setPressureSize: setActiveToolPressureSize,
      setPressureOpacity: setActiveToolPressureOpacity,
      setPressureCurve: setActiveToolPressureCurve,
      setAntiAliasStrength: setActiveAntiAliasStrength,
      setCustomBrushId: setActiveCustomBrushId,
      setSelectKind,
      setMoveMode,
      setMagicTolerance,
      setMagicContiguous,
      setMagicSampleAllLayers,
      setEyedropperSampleAllLayers,
      setBucketTolerance,
      setBucketGapClose,
      setBucketExpand,
      colorHistory,
      colorHistoryConfig,
    }),
    [
      brushCategory,
      canvasToolProps,
      colorHistory,
      colorHistoryConfig,
      setActiveAntiAliasStrength,
      setActiveBrushOpacity,
      setActiveBrushSize,
      setActiveCustomBrushId,
      setActiveStabilizer,
      setActiveToolPressureCurve,
      setActiveToolPressureOpacity,
      setActiveToolPressureSize,
      setBlurRadius,
      setBrushCategory,
      setBrushKind,
      setBucketExpand,
      setBucketGapClose,
      setBucketTolerance,
      setColor,
      setEraserKind,
      setEyedropperSampleAllLayers,
      setGradientKind,
      setGradientPreset,
      setGradientToTransparent,
      setMagicContiguous,
      setMagicSampleAllLayers,
      setMagicTolerance,
      setMoveMode,
      setSecondaryColor,
      setSelectKind,
      setShapeFill,
      setShapeKind,
      setShapeStroke,
      setShapeStrokeWidth,
    ]
  );

  return {
    toolOptionsProps,
    canvasToolProps,
  };
}
