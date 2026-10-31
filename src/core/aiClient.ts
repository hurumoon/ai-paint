import {
  AIImageMediaType,
  AIMode,
  AIResponse,
  WorkStage,
} from "../types";
import type { QuadrantId } from "./aiAnalysisContext";
import {
  chooseFocusQuadrantSystemPrompt,
  comparisonSystemPrompt,
  systemPromptFor,
} from "./ai/prompts";
import {
  parseAIResponseWithFallback,
  parseQuadrantId,
} from "./ai/parse";
import { invokeClaudeCommand } from "./ai/transport";

export {
  expandGuidesToDocSize,
} from "./ai/parse";
export {
  scoreChallenge,
} from "./ai/challengeScoring";
export type {
  ChallengeScoreResult,
  ScoreChallengeOptions,
} from "./ai/challengeScoring";
export {
  chatWithClaude,
} from "./ai/chat";
export type {
  ChatOptions,
  ChatResult,
} from "./ai/chat";

export interface ClaudeImagePayload {
  base64: string;
  mediaType: AIImageMediaType;
}

function pngImagePayload(base64: string): ClaudeImagePayload {
  return { base64, mediaType: "image/png" };
}

export interface AnalyzeOptions {
  mode: AIMode;
  stage: WorkStage;
  userPrompt: string;
  analysisContext?: string;
  enhancedAnalysis?: boolean;
  mainImageBase64: string;
  referenceImages: ClaudeImagePayload[];
  auxiliaryImages?: ClaudeImagePayload[];
  canvasWidth: number;
  canvasHeight: number;
  isZoomedSelection?: boolean;
}

export async function analyzeCanvas(opts: AnalyzeOptions): Promise<AIResponse> {
  const userText = [
    `画像サイズ: ${opts.canvasWidth}×${opts.canvasHeight}px (ただし guides 座標は必ず 0.0〜1.0 の正規化値で返すこと)`,
    opts.isZoomedSelection ? "（注: 選択範囲を切り出した部分画像です。座標もこの切り出した画像内の 0〜1 正規化座標で返してください）" : "",
    opts.analysisContext ? opts.analysisContext : "",
    "",
    `ユーザーからの相談: ${opts.userPrompt || "（指定なし。モードに従って評価してください）"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await invokeClaudeCommand("analyze_canvas_v2", {
    systemPrompt: systemPromptFor(opts.mode, opts.stage, opts.enhancedAnalysis),
    userText,
    mainImageBase64: opts.mainImageBase64,
    referenceImages: opts.referenceImages,
    auxiliaryImages: opts.auxiliaryImages ?? [],
  });

  return parseAIResponseWithFallback(result.text);
}

export interface ChooseFocusQuadrantOptions {
  mode: AIMode;
  stage: WorkStage;
  userPrompt: string;
  mainImageBase64: string;
  quadrantImagesBase64: string[];
  contextText: string;
}

export async function chooseFocusQuadrant(
  opts: ChooseFocusQuadrantOptions
): Promise<QuadrantId> {
  const result = await invokeClaudeCommand("analyze_canvas_v2", {
    systemPrompt: chooseFocusQuadrantSystemPrompt(),
    userText: [
      "1枚目は全体画像です。続く4枚はこの順です: leftTop, rightTop, leftBottom, rightBottom。",
      "もっとも具体的な改善指摘ができそうな分割を1つだけ選んでください。",
      `モード: ${opts.mode}`,
      `作業段階: ${opts.stage}`,
      opts.userPrompt ? `ユーザー指定: ${opts.userPrompt}` : "",
      "",
      opts.contextText,
    ].filter(Boolean).join("\n"),
    mainImageBase64: opts.mainImageBase64,
    referenceImages: [],
    auxiliaryImages: opts.quadrantImagesBase64.map(pngImagePayload),
  });
  return parseQuadrantId(result.text);
}

export interface CompareOptions {
  previousBase64: string;
  currentBase64: string;
  canvasWidth: number;
  canvasHeight: number;
}

export async function compareCanvas(opts: CompareOptions): Promise<AIResponse> {
  const result = await invokeClaudeCommand("analyze_canvas_v2", {
    systemPrompt: comparisonSystemPrompt(),
    userText: `画像サイズ: ${opts.canvasWidth}×${opts.canvasHeight}px。1枚目=以前、2枚目=現在。guides 座標は必ず 0.0〜1.0 の正規化値で返すこと。`,
    mainImageBase64: opts.previousBase64,
    referenceImages: [],
    auxiliaryImages: [pngImagePayload(opts.currentBase64)],
  });
  return parseAIResponseWithFallback(result.text);
}
