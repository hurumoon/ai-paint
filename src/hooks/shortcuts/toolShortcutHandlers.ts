import type { ShortcutHandlers, ToolShortcutOptions } from "./types";

export function createToolShortcutHandlers({
  toolState,
}: ToolShortcutOptions): ShortcutHandlers {
  const {
    setTool,
    toolRef,
    setEraserSize,
    brushCategoryRef,
    setBrushCategorySettings,
    colorRef,
    setColor,
    secondaryColorRef,
    setSecondaryColor,
  } = toolState;

  return {
    "tool.brush": () => setTool("brush"),
    "tool.eraser": () => setTool("eraser"),
    "tool.bucket": () => setTool("bucket"),
    "tool.eyedropper": () => setTool("eyedropper"),
    "tool.select": () => setTool("select"),
    "tool.shape": () => setTool("shape"),
    "tool.move": () => setTool("move"),
    "tool.layerPick": () => setTool("layerPick"),
    "tool.text": () => setTool("text"),
    "tool.gradient": () => setTool("gradient"),
    "tool.blur": () => setTool("blur"),
    "brush.sizeDown": () => {
      if (toolRef.current === "eraser") {
        setEraserSize((s) => Math.max(1, s - 2));
        return;
      }
      const category = brushCategoryRef.current;
      setBrushCategorySettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          size: Math.max(1, prev[category].size - 2),
        },
      }));
    },
    "brush.sizeUp": () => {
      if (toolRef.current === "eraser") {
        setEraserSize((s) => Math.min(200, s + 2));
        return;
      }
      const category = brushCategoryRef.current;
      setBrushCategorySettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          size: Math.min(200, prev[category].size + 2),
        },
      }));
    },
    "brush.stabilizerDown": () => {
      const category = brushCategoryRef.current;
      setBrushCategorySettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          stabilizer: Math.max(
            0,
            Math.round((prev[category].stabilizer - 0.05) * 100) / 100
          ),
        },
      }));
    },
    "brush.stabilizerUp": () => {
      const category = brushCategoryRef.current;
      setBrushCategorySettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          stabilizer: Math.min(
            0.95,
            Math.round((prev[category].stabilizer + 0.05) * 100) / 100
          ),
        },
      }));
    },
    "color.swap": () => {
      const cur = colorRef.current;
      setColor(secondaryColorRef.current);
      setSecondaryColor(cur);
    },
  };
}
