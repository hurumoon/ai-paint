import { Dispatch, SetStateAction, useEffect } from "react";
import { TimerMode } from "../../types";
import { FinishState } from "./types";

interface UseChallengeTimerOptions {
  running: boolean;
  timerMode: TimerMode;
  limitSec: number;
  getElapsedSec: () => number;
  setElapsedSec: Dispatch<SetStateAction<number>>;
  finishChallenge: (
    reason: FinishState["reason"],
    elapsedOverride?: number
  ) => Promise<void>;
}

export function useChallengeTimer({
  running,
  timerMode,
  limitSec,
  setElapsedSec,
  getElapsedSec,
  finishChallenge,
}: UseChallengeTimerOptions): void {
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const elapsed = getElapsedSec();
      setElapsedSec(timerMode === "countdown" ? Math.min(elapsed, limitSec) : elapsed);
      if (timerMode === "countdown" && elapsed >= limitSec) {
        void finishChallenge("timeout", limitSec);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [finishChallenge, getElapsedSec, limitSec, running, setElapsedSec, timerMode]);
}
