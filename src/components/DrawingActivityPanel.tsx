import { useEffect, useMemo, useState } from "react";
import {
  DrawingActivityDay,
  loadDrawingActivityDays,
  subscribeDrawingActivity,
} from "../core/drawingActivity";

interface GridDay {
  date: string;
  amount: number;
  operations: number;
  level: number;
  inRange: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_COUNT = 53;
const LEVEL_THRESHOLDS = [50000, 200000, 800000, 2500000];

export function DrawingActivityPanel() {
  const [days, setDays] = useState<DrawingActivityDay[]>(() =>
    loadDrawingActivityDays()
  );

  useEffect(() => {
    return subscribeDrawingActivity(() => setDays(loadDrawingActivityDays()));
  }, []);

  const summary = useMemo(() => buildSummary(days), [days]);

  return (
    <div className="section drawing-activity">
      <div className="section-title">制作芝</div>
      <div className="drawing-activity-stats">
        <div>
          <strong>{formatAmount(summary.todayAmount)}</strong>
          <span>今日</span>
        </div>
        <div>
          <strong>{summary.streak}</strong>
          <span>連続日</span>
        </div>
        <div>
          <strong>{summary.monthOperations}</strong>
          <span>今月</span>
        </div>
      </div>
      <div className="drawing-activity-scroll" aria-label="日別の描画量">
        <div className="drawing-activity-grid">
          {summary.grid.map((day) => (
            <span
              key={day.date}
              className={`drawing-activity-cell level-${day.level}${
                day.inRange ? "" : " out-of-range"
              }`}
              title={`${formatDate(day.date)}: ${formatAmount(day.amount)} / ${
                day.operations
              }操作`}
            />
          ))}
        </div>
      </div>
      <div className="drawing-activity-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`drawing-activity-cell level-${level}`}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

function buildSummary(days: DrawingActivityDay[]) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const today = startOfLocalDay(new Date());
  const todayKey = toLocalDateKey(today);
  const startOffsetDays = (WEEK_COUNT - 1) * 7 + today.getDay();
  const start = new Date(today.getTime() - startOffsetDays * DAY_MS);

  const grid: GridDay[] = [];
  for (let week = 0; week < WEEK_COUNT; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(start.getTime() + (week * 7 + weekday) * DAY_MS);
      const key = toLocalDateKey(date);
      const day = byDate.get(key);
      const inRange = date <= today;
      grid.push({
        date: key,
        amount: inRange ? day?.amount ?? 0 : 0,
        operations: inRange ? day?.operations ?? 0 : 0,
        level: inRange ? levelForAmount(day?.amount ?? 0) : 0,
        inRange,
      });
    }
  }

  const monthPrefix = todayKey.slice(0, 7);
  const monthOperations = days
    .filter((day) => day.date.startsWith(monthPrefix))
    .reduce((sum, day) => sum + day.operations, 0);

  return {
    grid,
    todayAmount: byDate.get(todayKey)?.amount ?? 0,
    streak: countStreak(byDate, today),
    monthOperations,
  };
}

function countStreak(days: Map<string, DrawingActivityDay>, today: Date): number {
  let streak = 0;
  for (let i = 0; i < 366; i += 1) {
    const date = new Date(today.getTime() - i * DAY_MS);
    const day = days.get(toLocalDateKey(date));
    if (!day || day.amount <= 0) break;
    streak += 1;
  }
  return streak;
}

function levelForAmount(amount: number): number {
  if (amount <= 0) return 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (amount >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(y, m - 1, d));
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(Math.round(amount));
}
