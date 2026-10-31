import { ChallengeRecord } from "../../types";
import { IconSparkles } from "../../ui/Icons";
import { FinishState, formatTime } from "./types";

interface Props {
  finishState: FinishState;
  challengePrompt: string;
  scorePending: boolean;
  isScoring: boolean;
  scoreError: string;
  scoreRecord: ChallengeRecord | null;
  onClose: () => void;
}

export function ChallengeScoreResultOverlay({
  finishState,
  challengePrompt,
  scorePending,
  isScoring,
  scoreError,
  scoreRecord,
  onClose,
}: Props) {
  return (
    <div className="ai-challenge-result-overlay">
      <div className="ai-challenge-result">
        <div className="ai-challenge-result-head">
          <span>{finishState.reason === "timeout" ? "時間切れ" : "課題終了"}</span>
          <button onClick={onClose} title="閉じる">×</button>
        </div>

        <div className="ai-challenge-result-prompt">{challengePrompt}</div>
        <div className="ai-challenge-result-meta">
          作業時間 {formatTime(finishState.durationSec)}
        </div>

        {(scorePending || isScoring) && (
          <div className="ai-challenge-scoring">
            <IconSparkles width={18} height={18} />
            AIが採点中...
          </div>
        )}

        {scoreError && <div className="ai-error">{scoreError}</div>}

        {scoreRecord && (
          <>
            <div className="ai-challenge-score">
              <strong>{scoreRecord.score}</strong>
              <span>点</span>
            </div>
            {scoreRecord.subscores && (
              <div className="ai-challenge-subscores">
                {typeof scoreRecord.subscores.structure === "number" && (
                  <span>構造 {scoreRecord.subscores.structure}</span>
                )}
                {typeof scoreRecord.subscores.color === "number" && (
                  <span>色 {scoreRecord.subscores.color}</span>
                )}
                {typeof scoreRecord.subscores.completion === "number" && (
                  <span>完成度 {scoreRecord.subscores.completion}</span>
                )}
              </div>
            )}
            <div className="ai-challenge-advice">{scoreRecord.advice}</div>
          </>
        )}
      </div>
    </div>
  );
}
