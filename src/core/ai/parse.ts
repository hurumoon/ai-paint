import { AIResponse, GuideShape } from "../../types";
import type { QuadrantId } from "../aiAnalysisContext";

export interface ChallengeScoreResult {
  score: number;
  subscores?: {
    structure?: number;
    color?: number;
    completion?: number;
  };
  advice: string;
  guides: GuideShape[];
}

export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;

  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

export function parseQuadrantId(text: string): QuadrantId {
  try {
    const jsonStr = extractJsonObject(text);
    const parsed = JSON.parse(jsonStr ?? text.trim()) as Record<string, unknown>;
    const quadrant = parsed.quadrant;
    if (
      quadrant === "leftTop" ||
      quadrant === "rightTop" ||
      quadrant === "leftBottom" ||
      quadrant === "rightBottom"
    ) {
      return quadrant;
    }
  } catch {
    // 選択JSONが崩れた場合でも解析全体は続行する。
  }
  return "leftTop";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v);
}

export function expandGuidesToDocSize(
  guides: GuideShape[],
  docWidth: number,
  docHeight: number,
  sentWidth: number,
  sentHeight: number
): GuideShape[] {
  if (guides.length === 0) return guides;

  let maxVal = 0;
  for (const g of guides) {
    const vals =
      g.type === "line"
        ? [g.x1, g.y1, g.x2, g.y2]
        : g.type === "circle"
        ? [g.cx, g.cy, g.r]
        : [g.x, g.y, g.w, g.h];
    for (const v of vals) if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
  }
  const denomX = maxVal >= 2 ? sentWidth : 1;
  const denomY = maxVal >= 2 ? sentHeight : 1;
  const denomR = maxVal >= 2 ? Math.max(sentWidth, sentHeight) : 1;

  return guides.map((g) => {
    if (g.type === "line") {
      return {
        ...g,
        x1: (g.x1 / denomX) * docWidth,
        y1: (g.y1 / denomY) * docHeight,
        x2: (g.x2 / denomX) * docWidth,
        y2: (g.y2 / denomY) * docHeight,
      };
    }
    if (g.type === "circle") {
      return {
        ...g,
        cx: (g.cx / denomX) * docWidth,
        cy: (g.cy / denomY) * docHeight,
        r: (g.r / denomR) * Math.max(docWidth, docHeight),
      };
    }
    return {
      ...g,
      x: (g.x / denomX) * docWidth,
      y: (g.y / denomY) * docHeight,
      w: (g.w / denomX) * docWidth,
      h: (g.h / denomY) * docHeight,
    };
  });
}

function sanitizeGuide(g: unknown): GuideShape | null {
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  const color = isHexColor(o.color) ? (o.color as string) : "#ff6b9d";
  const label = typeof o.label === "string" ? (o.label as string) : undefined;
  switch (o.type) {
    case "line":
      if (
        isFiniteNumber(o.x1) &&
        isFiniteNumber(o.y1) &&
        isFiniteNumber(o.x2) &&
        isFiniteNumber(o.y2)
      ) {
        return { type: "line", x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, color, label };
      }
      return null;
    case "circle":
      if (isFiniteNumber(o.cx) && isFiniteNumber(o.cy) && isFiniteNumber(o.r)) {
        return { type: "circle", cx: o.cx, cy: o.cy, r: o.r, color, label };
      }
      return null;
    case "rect":
      if (
        isFiniteNumber(o.x) &&
        isFiniteNumber(o.y) &&
        isFiniteNumber(o.w) &&
        isFiniteNumber(o.h)
      ) {
        return {
          type: "rect",
          x: o.x,
          y: o.y,
          w: o.w,
          h: o.h,
          color,
          label,
          highlight: typeof o.highlight === "boolean" ? (o.highlight as boolean) : undefined,
        };
      }
      return null;
    default:
      return null;
  }
}

export function parseAIResponse(text: string): AIResponse {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    const parsed = JSON.parse(text.trim());
    return finalizeAIResponse(parsed);
  }
  const parsed = JSON.parse(jsonStr);
  return finalizeAIResponse(parsed);
}

export function parseAIResponseWithFallback(text: string): AIResponse {
  try {
    return parseAIResponse(text);
  } catch {
    return {
      advice: text.trim(),
      guides: [],
    };
  }
}

function clampScore(v: unknown, fallback: number): number {
  if (!isFiniteNumber(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function parseChallengeScore(text: string): ChallengeScoreResult {
  const jsonStr = extractJsonObject(text);
  const parsed = JSON.parse(jsonStr ?? text.trim()) as Record<string, unknown>;
  const subs = (parsed.subscores && typeof parsed.subscores === "object"
    ? parsed.subscores
    : {}) as Record<string, unknown>;
  const guidesRaw = Array.isArray(parsed.guides) ? parsed.guides : [];
  const guides = guidesRaw
    .map(sanitizeGuide)
    .filter((g): g is GuideShape => g !== null);
  return {
    score: clampScore(parsed.score, 0),
    subscores: {
      structure: clampScore(subs.structure, 0),
      color: clampScore(subs.color, 0),
      completion: clampScore(subs.completion, 0),
    },
    advice:
      typeof parsed.advice === "string" && parsed.advice.trim()
        ? parsed.advice.trim()
        : "採点結果を取得しました。",
    guides,
  };
}

export function parseChallengeScoreWithFallback(text: string): ChallengeScoreResult {
  try {
    return parseChallengeScore(text);
  } catch {
    const fallbackAdvice = text.trim();
    return {
      score: 0,
      advice: fallbackAdvice
        ? `採点JSONを解析できませんでした。AIの返答をそのまま表示します。\n\n${fallbackAdvice}`
        : "採点JSONを解析できませんでした。",
      guides: [],
    };
  }
}

function finalizeAIResponse(parsed: unknown): AIResponse {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const guidesRaw = Array.isArray(p.guides) ? p.guides : [];
  const guides = guidesRaw
    .map(sanitizeGuide)
    .filter((g): g is GuideShape => g !== null);
  const paletteRaw = Array.isArray(p.palette) ? p.palette : null;
  const palette = paletteRaw
    ? ((paletteRaw as unknown[]).filter(isHexColor) as string[])
    : undefined;
  return {
    advice: typeof p.advice === "string" ? p.advice : "",
    guides,
    palette: palette && palette.length > 0 ? palette : undefined,
  };
}
