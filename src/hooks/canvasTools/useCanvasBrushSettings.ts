import { useCallback, useEffect, useRef } from "react";
import type { BrushSettings } from "../../core/brushEngine";
import { getCustomBrush, getCustomBrushBitmap } from "../../core/customBrush";
import type { PressureCurve } from "../../core/pressureCurve";
import type { BrushKind, EraserKind } from "../../types";

interface UseCanvasBrushSettingsOptions {
  brushKind: BrushKind;
  eraserKind: EraserKind;
  brushSize: number;
  brushOpacity: number;
  color: string;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
  antiAliasStrength: number;
  customBrushId: string | null;
}

export function useCanvasBrushSettings({
  brushKind,
  eraserKind,
  brushSize,
  brushOpacity,
  color,
  pressureSize,
  pressureOpacity,
  pressureCurve,
  antiAliasStrength,
  customBrushId,
}: UseCanvasBrushSettingsOptions): (toolNow: "brush" | "eraser") => BrushSettings {
  const customBitmapRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    let cancelled = false;
    customBitmapRef.current?.close();
    customBitmapRef.current = null;
    if (brushKind === "custom" && customBrushId) {
      getCustomBrushBitmap(customBrushId).then((bitmap) => {
        if (!bitmap) return;
        if (cancelled) {
          bitmap.close();
          return;
        }
        customBitmapRef.current = bitmap;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [brushKind, customBrushId]);

  useEffect(() => {
    return () => {
      customBitmapRef.current?.close();
      customBitmapRef.current = null;
    };
  }, []);

  return useCallback(
    (toolNow: "brush" | "eraser"): BrushSettings => {
      if (toolNow === "eraser") {
        const kindMap = {
          round: "eraser-round" as const,
          hard: "eraser-hard" as const,
          soft: "eraser-soft" as const,
        };
        return {
          kind: kindMap[eraserKind],
          size: brushSize,
          opacity: brushOpacity,
          color: "#000000",
          pressureSize,
          pressureOpacity,
          pressureCurve,
        };
      }

      if (brushKind === "custom") {
        const definition = customBrushId ? getCustomBrush(customBrushId) : null;
        const bitmap = customBitmapRef.current;
        if (!definition || !bitmap) {
          return {
            kind: "round",
            size: brushSize,
            opacity: brushOpacity,
            color,
            pressureSize,
            pressureOpacity,
            pressureCurve,
            antiAliasStrength,
          };
        }
        return {
          kind: "custom",
          size: brushSize,
          opacity: brushOpacity,
          color,
          pressureSize,
          pressureOpacity,
          pressureCurve,
          antiAliasStrength,
          custom: {
            bitmap,
            spacingRatio: definition.spacingRatio,
            tint: definition.tint,
          },
        };
      }

      return {
        kind: brushKind,
        size: brushSize,
        opacity: brushOpacity,
        color,
        pressureSize,
        pressureOpacity,
        pressureCurve,
        antiAliasStrength,
      };
    },
    [
      antiAliasStrength,
      brushKind,
      brushOpacity,
      brushSize,
      color,
      customBrushId,
      eraserKind,
      pressureCurve,
      pressureOpacity,
      pressureSize,
    ]
  );
}
