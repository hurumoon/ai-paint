import {
  ChallengeCategory,
  ScoringStrictness,
} from "../../types";
import {
  CHALLENGE_CATEGORY_LABEL,
  STRICTNESS_LABEL,
  challengeScoringSystemPrompt,
} from "./prompts";
import {
  ChallengeScoreResult,
  parseChallengeScoreWithFallback,
} from "./parse";
import { invokeClaudeCommand } from "./transport";

export type { ChallengeScoreResult } from "./parse";

export interface ScoreChallengeOptions {
  category: ChallengeCategory;
  prompt: string;
  strictness: ScoringStrictness;
  durationSec: number;
  mainImageBase64: string;
  canvasWidth: number;
  canvasHeight: number;
}

export async function scoreChallenge(
  opts: ScoreChallengeOptions
): Promise<ChallengeScoreResult> {
  const result = await invokeClaudeCommand("analyze_canvas_v2", {
    claudeTask: "challengeScoring",
    systemPrompt: challengeScoringSystemPrompt(),
    userText: [
      `課題カテゴリ: ${CHALLENGE_CATEGORY_LABEL[opts.category]}`,
      `課題内容: ${opts.prompt}`,
      `作業時間: ${Math.round(opts.durationSec)}秒`,
      `採点厳しさ: ${STRICTNESS_LABEL[opts.strictness]}`,
      `画像サイズ: ${opts.canvasWidth}×${opts.canvasHeight}px`,
    ].join("\n"),
    mainImageBase64: opts.mainImageBase64,
    referenceImages: [],
  });
  return parseChallengeScoreWithFallback(result.text);
}
