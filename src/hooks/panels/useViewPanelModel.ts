import { useMemo } from "react";
import type { AppPanelsViewState } from "../../components/panels/types";
import type { AppCanvasViewState } from "../useCanvasViewState";

interface UseViewPanelModelParams {
  viewState: AppCanvasViewState;
}

export function useViewPanelModel({
  viewState,
}: UseViewPanelModelParams): AppPanelsViewState {
  const {
    zoom,
    setZoom,
    setPan,
    rotation,
    setRotation,
    canvasFlipped,
    setCanvasFlipped,
    grid,
    setGrid,
  } = viewState;

  return useMemo<AppPanelsViewState>(
    () => ({
      zoom,
      setZoom,
      setPan,
      rotation,
      setRotation,
      canvasFlipped,
      setCanvasFlipped,
      grid,
      setGrid,
    }),
    [
      canvasFlipped,
      grid,
      rotation,
      setCanvasFlipped,
      setGrid,
      setPan,
      setRotation,
      setZoom,
      zoom,
    ]
  );
}
