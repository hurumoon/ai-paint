import { useEffect, useState } from "react";
import { DEFAULT_DRAWING_STAGES, type DrawingAgentSnapshot, type DrawingAgentStage } from "../../core/agent/session";

const labels = { idle: "未開始", running: "作業中", paused: "一時停止", completed: "完成", stopped: "中止", error: "エラーで停止", limit_reached: "上限に達して停止" };
const clock = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };

export function AgentProgress({ state, defaultStages = DEFAULT_DRAWING_STAGES }: { state: DrawingAgentSnapshot; defaultStages?: readonly DrawingAgentStage[] }) {
  const [now, setNow] = useState(() => Date.now());
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const activity = state.activity;
  const phaseMs = activity ? Math.max(0, now - activity.startedAt) : 0;
  const sinceProgress = activity ? Math.max(0, now - activity.lastProgressAt) : 0;
  const finished = state.stageStates.filter(stage => stage.status === "completed").length;
  const stages = state.stages.length ? state.stages : defaultStages;
  return <div className={`agent-progress is-${state.status}`} aria-label="制作状況">
    <div className="agent-progress-title"><span className={running ? "agent-busy-dot" : "agent-status-dot"} /><strong>{labels[state.status]}</strong>
      <span>{finished} / {stages.length}工程</span></div>
    <div className="agent-current-action" role="status" aria-live="polite">{state.settling ? "実行中の操作が終わるまで待っています" : running ? activity?.label || "作業を準備中" : state.error || state.stopReason || "指示とお手本を設定して開始"}</div>
    {running && <div className="agent-clock"><span>{activity?.phase === "thinking" ? "モデルの応答待ち" : "この作業"} {clock(phaseMs)}</span><span>最終進捗から {clock(sinceProgress)}</span></div>}
    {running && activity?.phase === "thinking" && phaseMs >= 60000 && <small>応答を待っています。時間がかかる場合は一時停止できます。</small>}
    {state.referenceProgress ? <>
      <progress aria-label="再描画の進捗" max={state.referenceProgress.totalStrokes || 1} value={state.referenceProgress.phase === "planning" && running ? undefined : state.referenceProgress.completedStrokes} />
      <div className="agent-progress-detail">{state.referenceProgress.completedStrokes.toLocaleString()} / {state.referenceProgress.totalStrokes.toLocaleString()}筆 · 操作 {state.usage.toolCalls}</div>
    </> : <><progress aria-label="完了した工程" max={stages.length} value={finished} />
      <div className="agent-progress-detail">{state.currentStage?.title ?? stages[0]?.title} · 反復 {state.usage.iterations} · 操作 {state.usage.toolCalls}</div></>}
    {state.status === "limit_reached" && <small>下の「上限設定」で到達した項目を増やし、続きを再開できます。</small>}
  </div>;
}
