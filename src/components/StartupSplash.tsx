import { useEffect, useLayoutEffect, useMemo, useState } from "react";

const STARTUP_SPLASH_EVENT = "ai-paint-startup-splash";

interface StartupSplashState {
  label: string;
  percent: number;
}

const INITIAL_STARTUP_SPLASH: StartupSplashState = {
  label: "アプリを初期化中...",
  percent: 24,
};

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function normalizeStartupSplashState(
  state: Partial<StartupSplashState> | undefined,
): StartupSplashState {
  return {
    label: typeof state?.label === "string" ? state.label : INITIAL_STARTUP_SPLASH.label,
    percent: clampPercent(
      typeof state?.percent === "number" ? state.percent : INITIAL_STARTUP_SPLASH.percent,
    ),
  };
}

function getWindowStartupSplash(): StartupSplashState {
  return normalizeStartupSplashState(window.__AI_PAINT_STARTUP_SPLASH__);
}

export function setStartupSplashProgress(label: string, percent: number): void {
  const next = normalizeStartupSplashState({ label, percent });
  window.__AI_PAINT_STARTUP_SPLASH__ = next;
  window.__AI_PAINT_SET_STARTUP_SPLASH__?.(next.label, next.percent);
  window.dispatchEvent(new CustomEvent<StartupSplashState>(STARTUP_SPLASH_EVENT, {
    detail: next,
  }));
}

export function StartupSplash() {
  const [state, setState] = useState<StartupSplashState>(getWindowStartupSplash);
  const [visible, setVisible] = useState(true);
  const stages = useMemo<StartupSplashState[]>(() => [
    { label: "テーマと設定を読み込み中...", percent: 40 },
    { label: "ワークスペースを準備中...", percent: 58 },
    { label: "キャンバス UI を初期化中...", percent: 74 },
    { label: "パネルを読み込み中...", percent: 88 },
    { label: "描画エンジンを準備中...", percent: 96 },
    { label: "起動完了", percent: 100 },
  ], []);

  useEffect(() => {
    const onStartupSplash = (event: Event) => {
      setState(normalizeStartupSplashState((event as CustomEvent<StartupSplashState>).detail));
    };
    window.addEventListener(STARTUP_SPLASH_EVENT, onStartupSplash);
    return () => window.removeEventListener(STARTUP_SPLASH_EVENT, onStartupSplash);
  }, []);

  useLayoutEffect(() => {
    document.getElementById("startup-splash")?.remove();
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    stages.forEach((stage, index) => {
      timers.push(window.setTimeout(() => {
        setState(stage);
      }, 80 + index * 140));
    });
    timers.push(window.setTimeout(() => {
      setVisible(false);
    }, 80 + stages.length * 140 + 180));

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [stages]);

  if (!visible) return null;

  return (
    <div className="startup-splash startup-splash-react" role="status" aria-live="polite">
      <div className="startup-splash-panel">
        <div className="startup-splash-brand">
          <img className="startup-splash-icon" src="/app-icon.png" alt="" />
          <h1 className="startup-splash-title">AI Paint</h1>
        </div>
        <p className="startup-splash-status">{state.label}</p>
        <div className="startup-splash-meter" aria-hidden="true">
          <div className="startup-splash-track">
            <div
              className="startup-splash-fill"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <div className="startup-splash-percent">{state.percent}%</div>
        </div>
      </div>
    </div>
  );
}
