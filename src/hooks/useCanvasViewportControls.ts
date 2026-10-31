import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import { matchPointerShortcut } from "../core/shortcuts";
import { MoveMode, ShortcutMap, Tool } from "../types";

interface Pan {
  x: number;
  y: number;
}

interface UseCanvasViewportControlsParams {
  areaRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLCanvasElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  setZoom: (z: number) => void;
  pan: Pan;
  setPan: (p: Pan) => void;
  rotation: number;
  canvasFlipped: boolean;
  tool: Tool;
  moveMode: MoveMode;
  shortcuts: ShortcutMap;
  isFileLoading: () => boolean;
}

export function useCanvasViewportControls({
  areaRef,
  inputRef,
  canvasWidth,
  canvasHeight,
  zoom,
  setZoom,
  pan,
  setPan,
  rotation,
  canvasFlipped,
  tool,
  moveMode,
  shortcuts,
  isFileLoading,
}: UseCanvasViewportControlsParams) {
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceDownRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const shortcutsRef = useRef(shortcuts);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  const hBarRef = useRef<HTMLDivElement>(null);
  const vBarRef = useRef<HTMLDivElement>(null);
  const ignoreScrollRef = useRef(false);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const baseCursor = useCallback((): string => {
    if (tool === "move") return moveMode === "canvas" ? "grab" : "move";
    if (tool === "layerPick") return "crosshair";
    return "";
  }, [tool, moveMode]);

  const setCursors = useCallback(
    (cursor: string) => {
      if (areaRef.current) areaRef.current.style.cursor = cursor;
      if (inputRef.current) inputRef.current.style.cursor = cursor;
    },
    [areaRef, inputRef]
  );

  useEffect(() => {
    if (isPanningRef.current || spaceDownRef.current) return;
    setCursors(baseCursor());
  }, [baseCursor, setCursors]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (!spaceDownRef.current) setCursors("grab");
      spaceDownRef.current = true;
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDownRef.current = false;
      if (!isPanningRef.current) setCursors(baseCursor());
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [baseCursor, setCursors]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = area.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 + panRef.current.x;
      const cy = rect.top + rect.height / 2 + panRef.current.y;
      const ox = e.clientX - cx;
      const oy = e.clientY - cy;
      const oldZoom = zoomRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.max(0.1, Math.min(8, oldZoom * factor));
      if (newZoom === oldZoom) return;
      const k = newZoom / oldZoom;
      setPan({
        x: panRef.current.x + ox * (1 - k),
        y: panRef.current.y + oy * (1 - k),
      });
      setZoom(newZoom);
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [areaRef, setZoom, setPan]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const update = () => {
      setAreaSize({ w: area.clientWidth, h: area.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [areaRef]);

  const shouldStartPan = useCallback(
    (e: PointerEvent<Element>): boolean => {
      if (isFileLoading()) return false;
      const isMiddle = e.button === 1;
      const isPanShortcut = matchPointerShortcut(e.nativeEvent, shortcutsRef.current, "view.pan");
      const isSpacePan = spaceDownRef.current && e.button === 0;
      const isMoveCanvasPan = tool === "move" && moveMode === "canvas" && e.button === 0;
      return isMiddle || isPanShortcut || isSpacePan || isMoveCanvasPan;
    },
    [isFileLoading, tool, moveMode]
  );

  const isPanning = useCallback((): boolean => isPanningRef.current, []);

  const handleViewportPointerDown = useCallback(
    (e: PointerEvent<Element>) => {
      if (!shouldStartPan(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      setCursors("grabbing");
    },
    [setCursors, shouldStartPan]
  );

  const handleViewportPointerMove = useCallback(
    (e: PointerEvent<Element>) => {
      if (!isPanningRef.current || !panStartRef.current) return;
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
    },
    [setPan]
  );

  const handleViewportPointerUp = useCallback(
    (e: PointerEvent<Element>) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      panStartRef.current = null;
      setCursors(spaceDownRef.current ? "grab" : baseCursor());
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    },
    [baseCursor, setCursors]
  );

  const rad = (rotation * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const stageW = (canvasWidth * absCos + canvasHeight * absSin) * zoom;
  const stageH = (canvasWidth * absSin + canvasHeight * absCos) * zoom;
  const padding = Math.max(40, Math.min(areaSize.w, areaSize.h) * 0.5);
  const contentW = Math.max(areaSize.w, stageW + padding * 2);
  const contentH = Math.max(areaSize.h, stageH + padding * 2);
  const targetScrollLeft = Math.max(0, (contentW - areaSize.w) / 2 - pan.x);
  const targetScrollTop = Math.max(0, (contentH - areaSize.h) / 2 - pan.y);

  useEffect(() => {
    ignoreScrollRef.current = true;
    if (hBarRef.current) hBarRef.current.scrollLeft = targetScrollLeft;
    if (vBarRef.current) vBarRef.current.scrollTop = targetScrollTop;
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, [targetScrollLeft, targetScrollTop]);

  const onHScroll = useCallback(() => {
    if (ignoreScrollRef.current || !hBarRef.current) return;
    const sl = hBarRef.current.scrollLeft;
    const newPanX = (contentW - areaSize.w) / 2 - sl;
    setPan({ x: newPanX, y: panRef.current.y });
  }, [areaSize.w, contentW, setPan]);

  const onVScroll = useCallback(() => {
    if (ignoreScrollRef.current || !vBarRef.current) return;
    const st = vBarRef.current.scrollTop;
    const newPanY = (contentH - areaSize.h) / 2 - st;
    setPan({ x: panRef.current.x, y: newPanY });
  }, [areaSize.h, contentH, setPan]);

  const stageStyle: CSSProperties = {
    width: canvasWidth,
    height: canvasHeight,
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${
      canvasFlipped ? -1 : 1
    })`,
  };

  return {
    contentW,
    contentH,
    hBarRef,
    vBarRef,
    handleViewportPointerDown,
    handleViewportPointerMove,
    handleViewportPointerUp,
    onHScroll,
    onVScroll,
    isPanning,
    shouldStartPan,
    stageStyle,
  };
}
