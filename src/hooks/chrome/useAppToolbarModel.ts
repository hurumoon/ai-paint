import { useMemo } from "react";
import type { AppChromeToolbarModel } from "../../components/AppChrome";
import type { UseAppChromeModelParams } from "./types";

export function useAppToolbarModel({
  tool: toolInputs,
}: UseAppChromeModelParams): AppChromeToolbarModel {
  const { toolState } = toolInputs;
  const {
    tool,
    brushCategory,
    handleToolClick,
    handleBrushCategoryClick,
  } = toolState;

  return useMemo<AppChromeToolbarModel>(
    () => ({
      tool,
      brushCategory,
      onToolClick: handleToolClick,
      onBrushCategoryClick: handleBrushCategoryClick,
    }),
    [brushCategory, handleBrushCategoryClick, handleToolClick, tool]
  );
}
