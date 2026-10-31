import { flushSync } from "react-dom";
import type { PaintApi, JsonSchema } from "../../core/paintApi";
import { BRUSH_CATEGORY_OPTIONS } from "../../core/brushCategories";
import { normalizeLayout, ALL_SECTIONS, ALL_TOP_BAR_ITEMS } from "../../core/panelLayout";
import { saveShortcuts, SHORTCUT_ACTIONS } from "../../core/shortcuts";
import type { AppApiContext } from "./appApiTypes";

export const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: "object", properties, required, additionalProperties: false });
export const numberSchema = (minimum: number, maximum: number): JsonSchema => ({ type: "number", minimum, maximum });
export const enumSchema = (values: readonly string[]): JsonSchema => ({ type: "string", enum: values });
export const booleanSchema: JsonSchema = { type: "boolean" };
export const stringSchema: JsonSchema = { type: "string", maxLength: 10000 };
const colorSchema = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
const pressureCurveSchema = objectSchema({ points: { type: "array", minItems: 2, maxItems: 32, items: objectSchema({ x: numberSchema(0, 1), y: numberSchema(0, 1) }, ["x", "y"]) } }, ["points"]);

interface Setting { schema: JsonSchema; get: () => unknown; set: (value: unknown) => void }
function setting<T>(schema: JsonSchema, get: () => T, set: (value: T) => void): Setting {
  return { schema, get, set: (value) => set(value as T) };
}
function registerGroup(api: PaintApi, name: string, title: string, entries: Record<string, Setting>, readOnly?: () => Record<string, unknown>) {
  const get = () => ({ ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value.get()])), ...readOnly?.() });
  api.register({ name: `${name}.get`, description: `${title}を取得`, parameters: objectSchema({}), mutates: false }, get);
  api.register({ name: `${name}.update`, description: `${title}を変更。指定した項目のみ更新。`, mutates: true,
    parameters: objectSchema(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value.schema]))) }, (args) => {
    // ブラシ種などの setter は現在カテゴリを参照する。カテゴリ変更を先に反映する。
    const changes = Object.entries(args).sort(([a], [b]) => Number(b === "brushCategory") - Number(a === "brushCategory"));
    for (const [key, value] of changes) flushSync(() => entries[key].set(value));
    return get();
  });
}

export function registerSettingsApi(api: PaintApi, ctx: () => AppApiContext) {
  const tool = () => ctx().tool;
  registerGroup(api, "tool", "ツール設定", {
    tool: setting(enumSchema(["brush", "eraser", "bucket", "select", "blur", "gradient", "shape", "eyedropper", "move", "text", "layerPick"]), () => tool().tool, v => tool().setTool(v)),
    color: setting(colorSchema, () => tool().color, v => tool().setColor(v)),
    secondaryColor: setting(colorSchema, () => tool().secondaryColor, v => tool().setSecondaryColor(v)),
    colorHistoryConfig: setting(objectSchema({ enabled: booleanSchema, display: enumSchema(["grid", "list", "compact"]), maxCount: { type: "integer", minimum: 1, maximum: 200 } }, ["enabled", "display", "maxCount"]), () => tool().colorHistoryConfig, v => tool().setColorHistoryConfig(v)),
    brushCategory: setting(enumSchema(["pen", "paint", "spray", "other"]), () => tool().brushCategory, v => tool().setBrushCategory(v)),
    brushKind: setting(enumSchema(Object.values(BRUSH_CATEGORY_OPTIONS).flat().map(v => v.value)), () => tool().activeBrushSettings.kind, v => tool().setBrushKind(v)),
    brushSize: setting(numberSchema(1, 2000), () => tool().activeBrushSettings.size, v => tool().setBrushSize(v)),
    brushOpacity: setting(numberSchema(0, 1), () => tool().activeBrushSettings.opacity, v => tool().setBrushOpacity(v)),
    pressureSize: setting(numberSchema(0, 1), () => tool().activeBrushSettings.pressureSize, v => tool().setActivePressureSize(v)),
    pressureOpacity: setting(numberSchema(0, 1), () => tool().activeBrushSettings.pressureOpacity, v => tool().setActivePressureOpacity(v)),
    pressureCurve: setting(pressureCurveSchema, () => tool().activeBrushSettings.pressureCurve, v => tool().setActivePressureCurve(v)),
    stabilizer: setting(numberSchema(0, 0.95), () => tool().activeBrushSettings.stabilizer, v => tool().setActiveStabilizer(v)),
    antiAliasStrength: setting(numberSchema(0, 1), () => tool().activeBrushSettings.antiAliasStrength, v => tool().setActiveAntiAliasStrength(v)),
    customBrushId: setting({ anyOf: [stringSchema, { type: "null" }] }, () => tool().activeBrushSettings.customBrushId, v => tool().setActiveCustomBrushId(v)),
    eraserSize: setting(numberSchema(1, 2000), () => tool().eraserSize, v => tool().setEraserSize(v)),
    eraserOpacity: setting(numberSchema(0, 1), () => tool().eraserOpacity, v => tool().setEraserOpacity(v)),
    eraserKind: setting(enumSchema(["round", "hard", "soft"]), () => tool().eraserKind, v => tool().setEraserKind(v)),
    eraserPressureSize: setting(numberSchema(0, 1), () => tool().pressureSize, v => tool().setPressureSize(v)),
    eraserPressureOpacity: setting(numberSchema(0, 1), () => tool().pressureOpacity, v => tool().setPressureOpacity(v)),
    eraserPressureCurve: setting(pressureCurveSchema, () => tool().pressureCurve, v => tool().setPressureCurve(v)),
    gradientKind: setting(enumSchema(["linear", "radial"]), () => tool().gradientKind, v => tool().setGradientKind(v)),
    gradientPreset: setting(enumSchema(["two-color", "rainbow"]), () => tool().gradientPreset, v => tool().setGradientPreset(v)),
    gradientToTransparent: setting(booleanSchema, () => tool().gradientToTransparent, v => tool().setGradientToTransparent(v)),
    shapeKind: setting(enumSchema(["rect", "ellipse", "line", "polygon"]), () => tool().shapeKind, v => tool().setShapeKind(v)),
    shapeFill: setting(booleanSchema, () => tool().shapeFill, v => tool().setShapeFill(v)),
    shapeStroke: setting(booleanSchema, () => tool().shapeStroke, v => tool().setShapeStroke(v)),
    shapeStrokeWidth: setting(numberSchema(0.1, 1000), () => tool().shapeStrokeWidth, v => tool().setShapeStrokeWidth(v)),
    blurRadius: setting(numberSchema(1, 100), () => tool().blurRadius, v => tool().setBlurRadius(v)),
    bucketTolerance: setting(numberSchema(0, 255), () => tool().bucketTolerance, v => tool().setBucketTolerance(v)),
    bucketGapClose: setting(numberSchema(0, 32), () => tool().bucketGapClose, v => tool().setBucketGapClose(v)),
    bucketExpand: setting(numberSchema(0, 32), () => tool().bucketExpand, v => tool().setBucketExpand(v)),
    selectKind: setting(enumSchema(["rect", "polygon", "magic"]), () => tool().selectKind, v => tool().setSelectKind(v)),
    moveMode: setting(enumSchema(["layer", "scale", "rotate", "free", "canvas"]), () => tool().moveMode, v => tool().setMoveMode(v)),
    magicTolerance: setting(numberSchema(0, 255), () => tool().magicTolerance, v => tool().setMagicTolerance(v)),
    magicContiguous: setting(booleanSchema, () => tool().magicContiguous, v => tool().setMagicContiguous(v)),
    magicSampleAllLayers: setting(booleanSchema, () => tool().magicSampleAllLayers, v => tool().setMagicSampleAllLayers(v)),
    eyedropperSampleAllLayers: setting(booleanSchema, () => tool().eyedropperSampleAllLayers, v => tool().setEyedropperSampleAllLayers(v)),
  }, () => ({ colorHistory: tool().colorHistory, brushCategorySettings: tool().brushCategorySettings }));
  const view = () => ctx().view;
  registerGroup(api, "view", "表示設定", {
    zoom: setting(numberSchema(0.01, 64), () => view().zoom, v => view().setZoom(v)),
    pan: setting(objectSchema({ x: numberSchema(-1e6, 1e6), y: numberSchema(-1e6, 1e6) }, ["x", "y"]), () => view().pan, v => view().setPan(v)),
    rotation: setting(numberSchema(-360, 360), () => view().rotation, v => view().setRotation(v)),
    canvasFlipped: setting(booleanSchema, () => view().canvasFlipped, v => view().setCanvasFlipped(v)),
    showSubview: setting(booleanSchema, () => view().showSubview, v => view().setShowSubview(v)),
    showReference: setting(booleanSchema, () => view().showReference, v => view().setShowReference(v)),
    grid: setting(objectSchema({ show: booleanSchema, spacing: numberSchema(1, 4096), color: colorSchema, divisions: numberSchema(1, 32) }, ["show", "spacing", "color", "divisions"]), () => view().grid, v => view().setGrid(v)),
  });
  const sectionArray = { type: "array", items: enumSchema(ALL_SECTIONS), maxItems: ALL_SECTIONS.length };
  const barArray = { type: "array", items: enumSchema(ALL_TOP_BAR_ITEMS), maxItems: ALL_TOP_BAR_ITEMS.length };
  registerGroup(api, "settings", "アプリ設定", {
    theme: setting(enumSchema(["light", "dark"]), () => ctx().theme, v => ctx().setTheme(v)),
    historyMemoryBudget: setting(numberSchema(16 * 1024 * 1024, 4 * 1024 * 1024 * 1024), () => ctx().historyMemoryBudget, v => ctx().setHistoryMemoryBudget(v)),
    enhancedAIEnabled: setting(booleanSchema, () => ctx().aiSettings.enhancedAIEnabled, v => ctx().aiSettings.setEnhancedAIEnabled(v)),
    aiGuideDisplayMode: setting(enumSchema(["pins", "guides"]), () => ctx().aiSettings.aiGuideDisplayMode, v => ctx().aiSettings.setAIGuideDisplayMode(v)),
    backupEnabled: setting(booleanSchema, () => ctx().actions.autoBackup.backupEnabled, v => ctx().actions.autoBackup.setBackupEnabled(v)),
    backupIntervalSec: setting(numberSchema(30, 86400), () => ctx().actions.autoBackup.backupIntervalSec, v => ctx().actions.autoBackup.setBackupIntervalSec(v)),
    layout: setting(objectSchema({ flipped: booleanSchema, leftSections: sectionArray, rightSections: sectionArray, hidden: sectionArray, topBarLeftItems: barArray, topBarRightItems: barArray, topBarHiddenItems: barArray }), () => ctx().layout, v => ctx().setLayout(normalizeLayout({ ...ctx().layout, ...v }))),
    shortcuts: setting(objectSchema(Object.fromEntries(SHORTCUT_ACTIONS.map(v => [v.id, { type: "string", maxLength: 80 }]))), () => ctx().shortcuts, v => { const next = { ...ctx().shortcuts, ...v }; saveShortcuts(next); ctx().setShortcuts(next); }),
  });
  api.register({ name: "tool.clear_color_history", description: "カラー履歴を消去", parameters: objectSchema({}), mutates: true }, () => { ctx().tool.handleClearColorHistory(); return { cleared: true }; });
}
