import { useEffect, useState } from "react";
import { GridConfig } from "../components/GridSettings";
import { GuideShape, Selection } from "../types";

const GRID_STORAGE = "ai-paint-grid";

const DEFAULT_GRID: GridConfig = {
  show: false,
  spacing: 64,
  color: "#7c8cff",
  divisions: 2,
};

export function useCanvasViewState() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [canvasFlipped, setCanvasFlipped] = useState(false);
  const [showSubview, setShowSubview] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [grid, setGrid] = useState<GridConfig>(() => {
    try {
      const raw = localStorage.getItem(GRID_STORAGE);
      if (raw) return { ...DEFAULT_GRID, ...JSON.parse(raw) };
    } catch {
      // 壊れた保存値は無視してデフォルトグリッドへ戻す。
    }
    return DEFAULT_GRID;
  });
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [highlightGuide, setHighlightGuide] = useState<GuideShape | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(GRID_STORAGE, JSON.stringify(grid));
    } catch {
      // localStorage が使えない環境ではグリッド設定保存だけ諦める。
    }
  }, [grid]);

  return {
    zoom,
    setZoom,
    pan,
    setPan,
    rotation,
    setRotation,
    canvasFlipped,
    setCanvasFlipped,
    showSubview,
    setShowSubview,
    showReference,
    setShowReference,
    grid,
    setGrid,
    selection,
    setSelection,
    highlightGuide,
    setHighlightGuide,
  };
}

export type AppCanvasViewState = ReturnType<typeof useCanvasViewState>;
