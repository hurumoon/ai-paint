import { useEffect, useState } from "react";
import { Button } from "../../ui/primitives";
import type { DrawingAgentController } from "../../hooks/agent/useDrawingAgent";

export function AgentPlayback({ controller, index, onChange }: {
  controller: DrawingAgentController;
  index: number | null;
  onChange: (index: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const count = controller.state.recording.frameCount;
  const running = controller.state.status === "running";
  const isPlaying = playing && !running && index !== null;
  const selected = index === null || running ? Math.max(0, count - 1) : Math.min(index, count - 1);
  useEffect(() => {
    if (!playing || running || index === null || count < 2) return;
    const timer = window.setTimeout(() => {
      if (index >= count - 1) setPlaying(false);
      else onChange(index + 1);
    }, 1000 / speed);
    return () => clearTimeout(timer);
  }, [count, index, onChange, playing, running, speed]);
  return <section className="agent-playback" aria-label="制作過程の再生">
    <div className="agent-section-title"><strong>制作過程</strong><small>{count}枚の記録</small></div>
    <div className="agent-playback-controls">
      <Button disabled={count < 2 || running} onClick={() => { if (!isPlaying) onChange(0); setPlaying(!isPlaying); }}>{isPlaying ? "再生停止" : "再生"}</Button>
      <input aria-label="制作過程の位置" type="range" min={0} max={Math.max(0, count - 1)} value={selected} disabled={!count || running}
        onChange={event => { setPlaying(false); onChange(Number(event.target.value)); }} />
      <select aria-label="再生速度" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
        <option value={2}>2枚/秒</option><option value={4}>4枚/秒</option><option value={12}>12枚/秒</option>
      </select>
    </div>
    {index !== null && !running && <div className="agent-section-title"><small>記録 {selected + 1} / {count} をキャンバスに表示中</small><Button onClick={() => { setPlaying(false); onChange(null); }}>現在の絵に戻る</Button></div>}
  </section>;
}
