import type { BlendMode } from "../types";

export type CustomBlendMode = "subtract";
export type NativeBlendMode = Exclude<BlendMode, CustomBlendMode>;

export function isCustomBlendMode(mode: BlendMode): mode is CustomBlendMode {
  return mode === "subtract";
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case "multiply":
      return backdrop * source;
    case "screen":
      return backdrop + source - backdrop * source;
    case "overlay":
      return backdrop <= 0.5
        ? 2 * backdrop * source
        : 1 - 2 * (1 - backdrop) * (1 - source);
    case "darken":
      return Math.min(backdrop, source);
    case "lighten":
      return Math.max(backdrop, source);
    case "color-dodge":
      if (backdrop <= 0) return 0;
      if (source >= 1) return 1;
      return Math.min(1, backdrop / (1 - source));
    case "color-burn":
      if (backdrop >= 1) return 1;
      if (source <= 0) return 0;
      return 1 - Math.min(1, (1 - backdrop) / source);
    case "linear-dodge":
      return Math.min(1, backdrop + source);
    case "subtract":
      return Math.max(0, backdrop - source);
    case "soft-light":
      if (source <= 0.5) {
        return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
      }
      return backdrop + (2 * source - 1) * (softLightD(backdrop) - backdrop);
    case "difference":
      return Math.abs(backdrop - source);
    case "normal":
    case "color":
    case "luminosity":
      return source;
  }
}

function softLightD(value: number): number {
  if (value <= 0.25) {
    return ((16 * value - 12) * value + 4) * value;
  }
  return Math.sqrt(value);
}

function lum(color: [number, number, number]): number {
  return 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
}

function clipColor(color: [number, number, number]): [number, number, number] {
  const l = lum(color);
  const n = Math.min(color[0], color[1], color[2]);
  const x = Math.max(color[0], color[1], color[2]);
  let out = color;
  if (n < 0) {
    out = [
      l + ((out[0] - l) * l) / (l - n),
      l + ((out[1] - l) * l) / (l - n),
      l + ((out[2] - l) * l) / (l - n),
    ];
  }
  if (x > 1) {
    out = [
      l + ((out[0] - l) * (1 - l)) / (x - l),
      l + ((out[1] - l) * (1 - l)) / (x - l),
      l + ((out[2] - l) * (1 - l)) / (x - l),
    ];
  }
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

function setLum(
  color: [number, number, number],
  targetLum: number
): [number, number, number] {
  const delta = targetLum - lum(color);
  return clipColor([color[0] + delta, color[1] + delta, color[2] + delta]);
}

function blendColor(
  mode: BlendMode,
  backdrop: [number, number, number],
  source: [number, number, number]
): [number, number, number] {
  if (mode === "color") return setLum(source, lum(backdrop));
  if (mode === "luminosity") return setLum(backdrop, lum(source));
  return [
    blendChannel(mode, backdrop[0], source[0]),
    blendChannel(mode, backdrop[1], source[1]),
    blendChannel(mode, backdrop[2], source[2]),
  ];
}

export function compositeBlendPixel(
  mode: BlendMode,
  backdropRgba: readonly [number, number, number, number],
  sourceRgba: readonly [number, number, number, number],
  opacity: number
): [number, number, number, number] {
  const sourceAlpha = clamp01((sourceRgba[3] / 255) * opacity);
  const backdropAlpha = clamp01(backdropRgba[3] / 255);
  const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return [0, 0, 0, 0];

  const sourceColor: [number, number, number] = [
    sourceRgba[0] / 255,
    sourceRgba[1] / 255,
    sourceRgba[2] / 255,
  ];
  const backdropColor: [number, number, number] = [
    backdropRgba[0] / 255,
    backdropRgba[1] / 255,
    backdropRgba[2] / 255,
  ];
  const blended = blendColor(mode, backdropColor, sourceColor);

  const result = [0, 1, 2].map((channel) => {
    const source = sourceColor[channel] * sourceAlpha * (1 - backdropAlpha);
    const backdrop = backdropColor[channel] * backdropAlpha * (1 - sourceAlpha);
    const mixed = blended[channel] * sourceAlpha * backdropAlpha;
    return (source + backdrop + mixed) / outAlpha;
  }) as [number, number, number];

  return [toByte(result[0]), toByte(result[1]), toByte(result[2]), toByte(outAlpha)];
}
