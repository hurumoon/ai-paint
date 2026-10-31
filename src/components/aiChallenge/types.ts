import {
  ChallengeItem,
  ChallengeRecord,
  ScoringStrictness,
  TimerMode,
} from "../../types";

export interface ScoreInput {
  category: ChallengeItem["category"];
  prompt: string;
  timerMode: TimerMode;
  durationSec: number;
  strictness: ScoringStrictness;
}

export interface FinishState {
  reason: "ended" | "timeout";
  durationSec: number;
}

export const TIMER_DURATIONS_MIN = [5, 10, 15, 30];

export const STRICTNESS_OPTIONS: {
  value: ScoringStrictness;
  label: string;
}[] = [
  { value: "gentle", label: "やさしめ" },
  { value: "normal", label: "標準" },
  { value: "strict", label: "厳しめ" },
];

export function formatTime(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const min = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${min}:${String(seconds).padStart(2, "0")}`;
}

export function nextDurationMin(current: number): number {
  const index = TIMER_DURATIONS_MIN.indexOf(current);
  return TIMER_DURATIONS_MIN[(index + 1) % TIMER_DURATIONS_MIN.length] ?? 10;
}

export type ScoreChallengeHandler = (
  input: ScoreInput
) => Promise<ChallengeRecord>;
