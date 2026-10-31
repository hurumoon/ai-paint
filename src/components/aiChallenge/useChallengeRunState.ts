import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { pickChallengeItem } from "../../core/challenges";
import { saveChallengeRecord } from "../../core/challengeRecords";
import {
  ChallengeItem,
  ChallengeRecord,
  ScoringStrictness,
  TimerMode,
} from "../../types";
import {
  FinishState,
  nextDurationMin,
  ScoreChallengeHandler,
} from "./types";
import { useChallengeTimer } from "./useChallengeTimer";

interface UseChallengeRunStateOptions {
  challengeItems: ChallengeItem[];
  isScoring: boolean;
  onScoreChallenge: ScoreChallengeHandler;
}

export function useChallengeRunState({
  challengeItems,
  isScoring,
  onScoreChallenge,
}: UseChallengeRunStateOptions) {
  const [open, setOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);
  const [challenge, setChallenge] = useState(() =>
    pickChallengeItem(challengeItems)
  );
  const [timerMode, setTimerMode] = useState<TimerMode>("countdown");
  const [strictness, setStrictness] = useState<ScoringStrictness>("normal");
  const [durationMin, setDurationMin] = useState(10);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [running, setRunningState] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);

  const getElapsedSec = useCallback(() => {
    const activeMs = startedAtRef.current === null
      ? 0
      : Math.max(0, Date.now() - startedAtRef.current);
    return Math.floor((accumulatedMsRef.current + activeMs) / 1000);
  }, []);

  const setRunning: Dispatch<SetStateAction<boolean>> = useCallback((value) => {
    const startedAt = startedAtRef.current;
    const wasRunning = startedAt !== null;
    const next = typeof value === "function" ? value(wasRunning) : value;
    if (next === wasRunning) return;
    if (next) {
      startedAtRef.current = Date.now();
    } else if (startedAt !== null) {
      // 一時停止を挟んでも端数秒を失わず、停止中の時間は加算しない。
      accumulatedMsRef.current += Math.max(0, Date.now() - startedAt);
      startedAtRef.current = null;
      setElapsedSec(getElapsedSec());
    }
    setRunningState(next);
  }, [getElapsedSec]);
  const [finishState, setFinishState] = useState<FinishState | null>(null);
  const [scoreRecord, setScoreRecord] = useState<ChallengeRecord | null>(null);
  const [scoreError, setScoreError] = useState("");
  const [scorePending, setScorePending] = useState(false);
  const finishingRef = useRef(false);

  const limitSec = durationMin * 60;
  const timerValue =
    timerMode === "countdown" ? Math.max(0, limitSec - elapsedSec) : elapsedSec;
  const locked = running || scorePending || isScoring;

  const finishChallenge = useCallback(
    async (reason: FinishState["reason"], elapsedOverride?: number) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setRunning(false);
      setScoreRecord(null);
      setScoreError("");
      setScorePending(true);

      const elapsed = getElapsedSec();
      const durationSec = Math.max(
        1,
        elapsedOverride ??
          (timerMode === "countdown" ? Math.min(elapsed, limitSec) : elapsed)
      );
      setFinishState({ reason, durationSec });

      try {
        const record = await onScoreChallenge({
          category: challenge.category,
          prompt: challenge.prompt,
          timerMode,
          durationSec,
          strictness,
        });
        await saveChallengeRecord(record);
        setRecordsRefreshKey((current) => current + 1);
        setScoreRecord(record);
      } catch (err) {
        setScoreError(
          err instanceof Error ? err.message : "AI採点に失敗しました"
        );
      } finally {
        setScorePending(false);
      }
    },
    [challenge, getElapsedSec, limitSec, onScoreChallenge, setRunning, strictness, timerMode]
  );

  useChallengeTimer({
    running,
    timerMode,
    limitSec,
    setElapsedSec,
    getElapsedSec,
    finishChallenge,
  });

  useEffect(() => {
    if (locked) return;
    const current = challengeItems.find((item) => item.id === challenge.id);
    if (current?.enabled && current.prompt === challenge.prompt) return;
    setChallenge((prev) => pickChallengeItem(challengeItems, prev));
  }, [challenge.id, challenge.prompt, challengeItems, locked]);

  const resetForNewRun = useCallback(() => {
    finishingRef.current = false;
    setFinishState(null);
    setScoreRecord(null);
    setScoreError("");
    setScorePending(false);
    startedAtRef.current = null;
    accumulatedMsRef.current = 0;
    setElapsedSec(0);
    setRunningState(false);
  }, []);

  const changeChallenge = useCallback(() => {
    if (locked) return;
    resetForNewRun();
    setChallenge((current) => pickChallengeItem(challengeItems, current));
  }, [challengeItems, locked, resetForNewRun]);

  const toggleTimerMode = useCallback(() => {
    if (locked) return;
    resetForNewRun();
    setTimerMode((current) =>
      current === "countdown" ? "countup" : "countdown"
    );
  }, [locked, resetForNewRun]);

  const cycleDuration = useCallback(() => {
    if (locked || timerMode === "countup") return;
    resetForNewRun();
    setDurationMin((current) => nextDurationMin(current));
  }, [locked, resetForNewRun, timerMode]);

  const closeResult = useCallback(() => {
    resetForNewRun();
    setOpen(false);
  }, [resetForNewRun]);

  return {
    open,
    setOpen,
    recordsOpen,
    setRecordsOpen,
    recordsRefreshKey,
    challenge,
    timerMode,
    strictness,
    setStrictness,
    elapsedSec,
    running,
    setRunning,
    finishState,
    scoreRecord,
    scoreError,
    scorePending,
    timerValue,
    locked,
    changeChallenge,
    toggleTimerMode,
    cycleDuration,
    finishChallenge,
    closeResult,
  };
}
