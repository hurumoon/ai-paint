import { ChallengeRecordsDialog } from "./ChallengeRecordsDialog";
import { ChallengePanel } from "./aiChallenge/ChallengePanel";
import { ChallengeScoreResultOverlay } from "./aiChallenge/ChallengeScoreResultOverlay";
import { ScoreChallengeHandler } from "./aiChallenge/types";
import { useChallengeRunState } from "./aiChallenge/useChallengeRunState";
import { ChallengeItem } from "../types";
import { IconSparkles } from "../ui/Icons";

interface Props {
  canScore: boolean;
  isScoring: boolean;
  challengeItems: ChallengeItem[];
  onScoreChallenge: ScoreChallengeHandler;
}

export function AIChallengeMode({
  canScore,
  isScoring,
  challengeItems,
  onScoreChallenge,
}: Props) {
  const run = useChallengeRunState({
    challengeItems,
    isScoring,
    onScoreChallenge,
  });

  return (
    <div
      className={`ai-challenge-mode ${run.open ? "open" : ""} ${
        run.running ? "running" : ""
      }`}
    >
      <button
        className="ai-challenge-launch"
        onClick={() => run.setOpen((value) => !value)}
        title="課題モード"
      >
        <IconSparkles width={18} height={18} />
      </button>

      {run.open && (
        <>
          <ChallengePanel
            canScore={canScore}
            isScoring={isScoring}
            challenge={run.challenge}
            timerMode={run.timerMode}
            strictness={run.strictness}
            setStrictness={run.setStrictness}
            elapsedSec={run.elapsedSec}
            running={run.running}
            setRunning={run.setRunning}
            finishState={run.finishState}
            scorePending={run.scorePending}
            timerValue={run.timerValue}
            locked={run.locked}
            changeChallenge={run.changeChallenge}
            toggleTimerMode={run.toggleTimerMode}
            cycleDuration={run.cycleDuration}
            finishChallenge={(reason) => void run.finishChallenge(reason)}
            onOpenRecords={() => run.setRecordsOpen(true)}
          />
        </>
      )}

      {run.finishState && (
        <ChallengeScoreResultOverlay
          finishState={run.finishState}
          challengePrompt={run.challenge.prompt}
          scorePending={run.scorePending}
          isScoring={isScoring}
          scoreError={run.scoreError}
          scoreRecord={run.scoreRecord}
          onClose={run.closeResult}
        />
      )}

      <ChallengeRecordsDialog
        open={run.recordsOpen}
        refreshKey={run.recordsRefreshKey}
        onClose={() => run.setRecordsOpen(false)}
      />
    </div>
  );
}
