import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrushCategory,
  BrushKind,
  EraserKind,
} from "../types";
import { LINEAR_CURVE, normalizeCurve, PressureCurve } from "../core/pressureCurve";
import {
  BRUSH_CATEGORIES,
  isBrushKindInCategory,
} from "../core/brushCategories";
import { safeGetStorageItem, safeSetStorageItem } from "../core/safeStorage";

const STABILIZER_STORAGE = "ai-paint-stabilizer";
const PRESSURE_SIZE_STORAGE = "ai-paint-pressure-size";
const PRESSURE_OPACITY_STORAGE = "ai-paint-pressure-opacity";
const BRUSH_SIZE_STORAGE = "ai-paint-brush-size";
const ERASER_SIZE_STORAGE = "ai-paint-eraser-size";
const PRESSURE_CURVE_STORAGE = "ai-paint-pressure-curve";
const BRUSH_CATEGORY_STORAGE = "ai-paint-brush-category-settings";
const BRUSH_CATEGORY_SELECTION_STORAGE = "ai-paint-brush-category";

export interface BrushCategorySettings {
  kind: BrushKind;
  size: number;
  opacity: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
  antiAliasStrength: number;
  stabilizer: number;
  customBrushId: string | null;
}

export type BrushCategorySettingsMap = Record<BrushCategory, BrushCategorySettings>;

const BRUSH_CATEGORY_DEFAULTS: BrushCategorySettingsMap = {
  pen: {
    kind: "pen",
    size: 8,
    opacity: 1,
    pressureSize: 0.6,
    pressureOpacity: 0.4,
    pressureCurve: LINEAR_CURVE,
    antiAliasStrength: 0.5,
    stabilizer: 0,
    customBrushId: null,
  },
  paint: {
    kind: "watercolor",
    size: 20,
    opacity: 0.8,
    pressureSize: 0.6,
    pressureOpacity: 0.4,
    pressureCurve: LINEAR_CURVE,
    antiAliasStrength: 0.5,
    stabilizer: 0.1,
    customBrushId: null,
  },
  spray: {
    kind: "airbrush",
    size: 36,
    opacity: 0.45,
    pressureSize: 0.3,
    pressureOpacity: 0.3,
    pressureCurve: LINEAR_CURVE,
    antiAliasStrength: 0.5,
    stabilizer: 0,
    customBrushId: null,
  },
  other: {
    kind: "dotted",
    size: 12,
    opacity: 1,
    pressureSize: 0.4,
    pressureOpacity: 0.3,
    pressureCurve: LINEAR_CURVE,
    antiAliasStrength: 0.5,
    stabilizer: 0,
    customBrushId: null,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isBrushCategory(value: unknown): value is BrushCategory {
  return (
    typeof value === "string" &&
    BRUSH_CATEGORIES.some((category) => category.value === value)
  );
}

function readPressureCurve(value: unknown, fallback: PressureCurve): PressureCurve {
  if (!isRecord(value) || !Array.isArray(value.points)) return fallback;
  try {
    return normalizeCurve(value as unknown as PressureCurve);
  } catch {
    return fallback;
  }
}

function mergeBrushCategorySettings(
  category: BrushCategory,
  value: unknown,
  fallback: BrushCategorySettings
): BrushCategorySettings {
  if (!isRecord(value)) return fallback;
  const kind =
    typeof value.kind === "string" &&
    isBrushKindInCategory(category, value.kind as BrushKind)
      ? (value.kind as BrushKind)
      : fallback.kind;
  return {
    kind,
    size: clampNumber(value.size, fallback.size, 1, 200),
    opacity: clampNumber(value.opacity, fallback.opacity, 0, 1),
    pressureSize: clampNumber(value.pressureSize, fallback.pressureSize, 0, 1),
    pressureOpacity: clampNumber(value.pressureOpacity, fallback.pressureOpacity, 0, 1),
    pressureCurve: readPressureCurve(value.pressureCurve, fallback.pressureCurve),
    antiAliasStrength: clampNumber(
      value.antiAliasStrength,
      fallback.antiAliasStrength,
      0,
      1
    ),
    stabilizer: clampNumber(value.stabilizer, fallback.stabilizer, 0, 0.95),
    customBrushId: typeof value.customBrushId === "string" ? value.customBrushId : null,
  };
}

function loadBrushCategorySettings(): BrushCategorySettingsMap {
  const migratedDefaults: BrushCategorySettingsMap = {
    ...BRUSH_CATEGORY_DEFAULTS,
    pen: {
      ...BRUSH_CATEGORY_DEFAULTS.pen,
      size: clampNumber(
        safeGetStorageItem(BRUSH_SIZE_STORAGE),
        BRUSH_CATEGORY_DEFAULTS.pen.size,
        1,
        200
      ),
      pressureSize: clampNumber(
        safeGetStorageItem(PRESSURE_SIZE_STORAGE),
        BRUSH_CATEGORY_DEFAULTS.pen.pressureSize,
        0,
        1
      ),
      pressureOpacity: clampNumber(
        safeGetStorageItem(PRESSURE_OPACITY_STORAGE),
        BRUSH_CATEGORY_DEFAULTS.pen.pressureOpacity,
        0,
        1
      ),
      stabilizer: clampNumber(
        safeGetStorageItem(STABILIZER_STORAGE),
        BRUSH_CATEGORY_DEFAULTS.pen.stabilizer,
        0,
        0.95
      ),
    },
  };

  try {
    const raw = safeGetStorageItem(BRUSH_CATEGORY_STORAGE);
    if (!raw) return migratedDefaults;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return migratedDefaults;
    return {
      pen: mergeBrushCategorySettings("pen", parsed.pen, migratedDefaults.pen),
      paint: mergeBrushCategorySettings("paint", parsed.paint, migratedDefaults.paint),
      spray: mergeBrushCategorySettings("spray", parsed.spray, migratedDefaults.spray),
      other: mergeBrushCategorySettings("other", parsed.other, migratedDefaults.other),
    };
  } catch {
    return migratedDefaults;
  }
}

function loadBrushCategory(): BrushCategory {
  const raw = safeGetStorageItem(BRUSH_CATEGORY_SELECTION_STORAGE);
  return isBrushCategory(raw) ? raw : "pen";
}

export function useBrushSettingsController() {
  const [brushCategory, setBrushCategoryState] =
    useState<BrushCategory>(() => loadBrushCategory());
  const brushCategoryRef = useRef(brushCategory);
  useEffect(() => {
    brushCategoryRef.current = brushCategory;
    safeSetStorageItem(BRUSH_CATEGORY_SELECTION_STORAGE, brushCategory);
  }, [brushCategory]);

  const [brushCategorySettings, setBrushCategorySettings] =
    useState<BrushCategorySettingsMap>(() => loadBrushCategorySettings());
  useEffect(() => {
    safeSetStorageItem(
      BRUSH_CATEGORY_STORAGE,
      JSON.stringify(brushCategorySettings)
    );
  }, [brushCategorySettings]);

  const updateBrushCategorySettings = useCallback(
    (category: BrushCategory, patch: Partial<BrushCategorySettings>) => {
      setBrushCategorySettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          ...patch,
        },
      }));
    },
    []
  );

  const activeBrushSettings = brushCategorySettings[brushCategory];
  const setBrushCategory = useCallback((category: BrushCategory) => {
    setBrushCategoryState(category);
  }, []);
  const setBrushSize = useCallback(
    (size: number) => updateBrushCategorySettings(brushCategory, { size }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setBrushOpacity = useCallback(
    (opacity: number) => updateBrushCategorySettings(brushCategory, { opacity }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setBrushKind = useCallback(
    (kind: BrushKind) => updateBrushCategorySettings(brushCategory, { kind }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActivePressureSize = useCallback(
    (pressureSizeNext: number) =>
      updateBrushCategorySettings(brushCategory, { pressureSize: pressureSizeNext }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActivePressureOpacity = useCallback(
    (pressureOpacityNext: number) =>
      updateBrushCategorySettings(brushCategory, { pressureOpacity: pressureOpacityNext }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActivePressureCurve = useCallback(
    (pressureCurveNext: PressureCurve) =>
      updateBrushCategorySettings(brushCategory, {
        pressureCurve: normalizeCurve(pressureCurveNext),
      }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActiveAntiAliasStrength = useCallback(
    (antiAliasStrengthNext: number) =>
      updateBrushCategorySettings(brushCategory, {
        antiAliasStrength: antiAliasStrengthNext,
      }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActiveStabilizer = useCallback(
    (stabilizerNext: number) =>
      updateBrushCategorySettings(brushCategory, { stabilizer: stabilizerNext }),
    [brushCategory, updateBrushCategorySettings]
  );
  const setActiveCustomBrushId = useCallback(
    (customBrushIdNext: string | null) =>
      updateBrushCategorySettings(brushCategory, { customBrushId: customBrushIdNext }),
    [brushCategory, updateBrushCategorySettings]
  );

  const [eraserSize, setEraserSize] = useState(() => {
    const value = safeGetStorageItem(ERASER_SIZE_STORAGE);
    return value !== null ? Number(value) : 8;
  });
  useEffect(() => {
    safeSetStorageItem(ERASER_SIZE_STORAGE, String(eraserSize));
  }, [eraserSize]);
  const [eraserOpacity, setEraserOpacity] = useState(1);
  const [eraserKind, setEraserKind] = useState<EraserKind>("round");

  const [pressureSize, setPressureSize] = useState(() => {
    const value = safeGetStorageItem(PRESSURE_SIZE_STORAGE);
    return value !== null ? Number(value) : 0.6;
  });
  const [pressureOpacity, setPressureOpacity] = useState(() => {
    const value = safeGetStorageItem(PRESSURE_OPACITY_STORAGE);
    return value !== null ? Number(value) : 0.4;
  });
  const [pressureCurve, setPressureCurveRaw] = useState<PressureCurve>(() => {
    try {
      const raw = safeGetStorageItem(PRESSURE_CURVE_STORAGE);
      if (raw) return normalizeCurve(JSON.parse(raw));
    } catch {
      // 壊れた保存値は無視してデフォルト曲線へ戻す。
    }
    return LINEAR_CURVE;
  });
  const setPressureCurve = useCallback((curve: PressureCurve) => {
    setPressureCurveRaw(normalizeCurve(curve));
  }, []);
  useEffect(() => {
    safeSetStorageItem(PRESSURE_SIZE_STORAGE, String(pressureSize));
  }, [pressureSize]);
  useEffect(() => {
    safeSetStorageItem(PRESSURE_OPACITY_STORAGE, String(pressureOpacity));
  }, [pressureOpacity]);
  useEffect(() => {
    safeSetStorageItem(PRESSURE_CURVE_STORAGE, JSON.stringify(pressureCurve));
  }, [pressureCurve]);

  return {
    brushCategory,
    brushCategoryRef,
    setBrushCategory,
    brushCategorySettings,
    setBrushCategorySettings,
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
  };
}
