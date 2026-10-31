import { useCallback } from "react";
import {
  expandGuidesToDocSize,
  scoreChallenge,
} from "../../core/aiClient";
import { flattenDocumentToBase64ForAI } from "../../core/aiImagePayload";
import { PaintDocument } from "../../core/PaintDocument";
import {
  ChallengeCategory,
  ChallengeRecord,
  ScoringStrictness,
  TimerMode,
} from "../../types";
import { pushToast } from "../../ui/primitives";
import type { TabUiStatePatch } from "../useTabs";

const CHALLENGE_THUMBNAIL_MAX_EDGE = 160;

export interface ScoreChallengeInput {
  category: ChallengeCategory;
  prompt: string;
  timerMode: TimerMode;
  durationSec: number;
  strictness: ScoringStrictness;
}

interface UseAIChallengeScoringOptions {
  activeTabId: string | null;
  doc: PaintDocument | null;
  hasApiKey: boolean;
  setIsChallengeScoring: (value: boolean) => void;
  applyTabUiStatePatch: (targetTabId: string | null, patch: TabUiStatePatch) => boolean;
}

export function useAIChallengeScoring({
  activeTabId,
  doc,
  hasApiKey,
  setIsChallengeScoring,
  applyTabUiStatePatch,
}: UseAIChallengeScoringOptions): (
  input: ScoreChallengeInput
) => Promise<ChallengeRecord> {
  return useCallback(
    async (input: ScoreChallengeInput): Promise<ChallengeRecord> => {
      const targetTabId = activeTabId;
      if (!doc) throw new Error("キャンバスがありません");
      if (!hasApiKey) throw new Error("API キーを入れてください");

      setIsChallengeScoring(true);
      applyTabUiStatePatch(targetTabId, { error: "" });
      try {
        const payload = await flattenDocumentToBase64ForAI(doc);
        const thumbnailPayload = await flattenDocumentToBase64ForAI(
          doc,
          CHALLENGE_THUMBNAIL_MAX_EDGE
        );
        const result = await scoreChallenge({
          category: input.category,
          prompt: input.prompt,
          strictness: input.strictness,
          durationSec: input.durationSec,
          mainImageBase64: payload.base64,
          canvasWidth: payload.width,
          canvasHeight: payload.height,
        });
        applyTabUiStatePatch(targetTabId, {
          advice: result.advice,
          guides: expandGuidesToDocSize(
            result.guides,
            doc.width,
            doc.height,
            payload.width,
            payload.height
          ),
          showGuides: true,
        });
        pushToast(`課題を記録しました: ${result.score}点`, "success");
        return {
          id: `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          category: input.category,
          prompt: input.prompt,
          timerMode: input.timerMode,
          durationSec: input.durationSec,
          strictness: input.strictness,
          score: result.score,
          subscores: result.subscores,
          advice: result.advice,
          thumbnailBase64: thumbnailPayload.base64,
        };
      } finally {
        setIsChallengeScoring(false);
      }
    },
    [
      activeTabId,
      applyTabUiStatePatch,
      doc,
      hasApiKey,
      setIsChallengeScoring,
    ]
  );
}
