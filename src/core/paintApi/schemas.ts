import type { JsonSchema } from "./types";

export const emptyObjectSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const pointSchema: JsonSchema = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    pressure: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y"],
  additionalProperties: false,
};

export const colorSchema: JsonSchema = {
  type: "string",
  pattern: "^#[0-9a-fA-F]{6}$",
};

export const brushKinds = [
  "round", "pencil", "marker", "airbrush", "calligraphy", "pen", "watercolor",
  "charcoal", "spray", "dotted", "crayon", "oil", "pastel", "fountainPen",
  "chalk", "scatter", "gPen", "maruPen", "highlighter", "neon", "sparkle", "custom",
] as const;

export const blendModes = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge",
  "color-burn", "linear-dodge", "subtract", "soft-light", "difference", "color", "luminosity",
] as const;

export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export function enumSchema(values: readonly string[]): JsonSchema {
  return { type: "string", enum: [...values] };
}
