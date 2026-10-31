import { ChallengeItem, ScoringStrictness, TimerMode } from "../../types";
import {
  IconArrowDown,
  IconArrowUp,
  IconClock,
  IconRotate,
} from "../../ui/Icons";
import {
  FinishState,
  formatTime,
  STRICTNESS_OPTIONS,
} from "./types";

interface Props {
  canScore: boolean;
  isScoring: boolean;
  challenge: ChallengeItem;
  timerMode: TimerMode;
  strictness: ScoringStrictness;
  setStrictness: (strictness: ScoringStrictness) => void;
  elapsedSec: number;
  running: boolean;
  setRunning: (updater: (running: boolean) => boolean) => void;
  finishState: FinishState | null;
  scorePending: boolean;
  timerValue: number;
  locked: boolean;
  changeChallenge: () => void;
  toggleTimerMode: () => void;
  cycleDuration: () => void;
  finishChallenge: (reason: FinishState["reason"]) => void;
  onOpenRecords: () => void;
}

export function ChallengePanel({
  canScore,
  isScoring,
  challenge,
  timerMode,
  strictness,
  setStrictness,
  elapsedSec,
  running,
  setRunning,
  finishState,
  scorePending,
  timerValue,
  locked,
  changeChallenge,
  toggleTimerMode,
  cycleDuration,
  finishChallenge,
  onOpenRecords,
}: Props) {
  return (
    <div className="ai-challenge-panel" role="group" aria-label="課題モード">
      <div className="ai-challenge-part ai-challenge-task">
        <span className="ai-challenge-kicker">今日の課題</span>
        <button
          className="ai-challenge-card"
          onClick={changeChallenge}
          disabled={locked}
          title="タップで別の課題に変更"
        >
          <span>{challenge.prompt}</span>
          <IconRotate width={15} height={15} />
        </button>
      </div>

      <div className="ai-challenge-control-parts">
        <button
          className="ai-challenge-part ai-challenge-mode-toggle"
          onClick={toggleTimerMode}
          disabled={locked}
          title={
            timerMode === "countdown"
              ? "カウントダウン。クリックでカウントアップへ"
              : "カウントアップ。クリックでカウントダウンへ"
          }
        >
          {timerMode === "countdown" ? (
            <IconArrowDown width={18} height={18} />
          ) : (
            <IconArrowUp width={18} height={18} />
          )}
        </button>

        <button
          className="ai-challenge-part ai-challenge-time"
          onClick={cycleDuration}
          disabled={locked || timerMode === "countup"}
          title={
            timerMode === "countdown"
              ? "クリックで制限時間を変更"
              : "カウントアップは手動終了です"
          }
        >
          <IconClock width={16} height={16} />
          <span>{formatTime(timerValue)}</span>
        </button>

        <button
          className="ai-challenge-part ai-challenge-run"
          onClick={() => setRunning((value) => !value)}
          disabled={scorePending || isScoring || Boolean(finishState)}
        >
          {running ? "一時停止" : elapsedSec > 0 ? "再開" : "開始"}
        </button>

        <button
          className="ai-challenge-part ai-challenge-end"
          onClick={() => finishChallenge("ended")}
          disabled={scorePending || isScoring || Boolean(finishState)}
          title={canScore ? "課題を終了して採点" : "API キーがない場合は採点できません"}
        >
          終了
        </button>
      </div>

      <div className="ai-challenge-meta-controls">
        <label className="ai-challenge-strictness">
          <span>採点</span>
          <select
            className="select"
            value={strictness}
            onChange={(e) => setStrictness(e.target.value as ScoringStrictness)}
            disabled={locked}
            title="採点の厳しさ"
          >
            {STRICTNESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ai-challenge-records-button"
          onClick={onOpenRecords}
          title="課題記録を開く"
        >
          記録
        </button>
      </div>
    </div>
  );
}
