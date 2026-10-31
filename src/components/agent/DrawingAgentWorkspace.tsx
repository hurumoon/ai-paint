import { useEffect, useRef, useState } from "react";
import { Button, pushToast } from "../../ui/primitives";
import { IconBrush } from "../../ui/Icons";
import { clearGptApiKey, hasGptApiKey, setGptApiKey } from "../../core/agent/modelClient";
import { DEFAULT_ANTHROPIC_AGENT_MODEL, DEFAULT_OPENAI_AGENT_MODEL, type ModelProvider } from "../../core/agent/modelTypes";
import { safeGetStorageItem, safeSetStorageItem } from "../../core/safeStorage";
import { DEFAULT_DRAWING_AGENT_LIMITS, DEFAULT_DRAWING_STAGES, type DrawingAgentLimits, type DrawingAgentStatus } from "../../core/agent/session";
import { REFERENCE_DRAWING_STAGES } from "../../core/agent/referenceRun";
import type { DrawingAgentController } from "../../hooks/agent/useDrawingAgent";
import { useAgentReferences } from "../../hooks/agent/useAgentReferences";
import { AgentPlayback } from "./AgentPlayback";
import { AgentApiInspector } from "./AgentApiInspector";
import { AgentProgress } from "./AgentProgress";
import { AgentReferences } from "./AgentReferences";
import { isTauri } from "../../utils/saveFile";
import "../../styles/agent.css";

export interface DrawingAgentPanelProps {
  controller: DrawingAgentController;
  hasDocument: boolean;
  focusRequest: number;
  playbackIndex: number | null;
  onPlaybackChange: (index: number | null) => void;
  onBusyChange: (busy: boolean) => void;
  claudeAuth: { configured: boolean; setKey: (key: string) => Promise<boolean>; clearKey: () => Promise<boolean> };
}

interface PanelDraft {
  prompt: string;
  provider: ModelProvider;
  model: string;
  limits: DrawingAgentLimits;
  mode: "model" | "reference";
  referenceId: string;
  sessionId?: string;
  sessionStatus: DrawingAgentStatus;
}

// 配置変更でセクションが再マウントされても、未実行の入力を同じタブで保持する。
const panelDrafts = new WeakMap<DrawingAgentController["agent"], PanelDraft>();

const limitFields: { key: keyof DrawingAgentLimits; title: string; max: number }[] = [
  { key: "maxIterations", title: "反復回数", max: 1000 },
  { key: "maxModelCalls", title: "モデル呼出回数", max: 1000 },
  { key: "maxToolCalls", title: "操作回数", max: 10000 },
  { key: "maxTotalTokens", title: "合計トークン", max: 2000000 },
  { key: "maxInputTokens", title: "入力トークン", max: 2000000 },
  { key: "maxOutputTokens", title: "出力トークン", max: 2000000 },
];

export function DrawingAgentPanel({ controller, hasDocument, focusRequest, claudeAuth, playbackIndex, onPlaybackChange, onBusyChange }: DrawingAgentPanelProps) {
  const { state, agent } = controller;
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusRequest > 0) panelRef.current?.scrollIntoView({ block: "start" });
  }, [focusRequest]);
  const initial = useRef<PanelDraft>();
  if (!initial.current) {
    const saved = agent.getSession();
    const session = saved?.mode === "reference" ? undefined : saved;
    const provider = session?.provider ?? (safeGetStorageItem("ai-paint-agent-provider") === "anthropic" ? "anthropic" : "openai");
    initial.current = panelDrafts.get(agent) ?? {
      prompt: session?.prompt ?? "", provider,
      model: session?.model ?? safeGetStorageItem("ai-paint-agent-model") ?? (provider === "openai" ? DEFAULT_OPENAI_AGENT_MODEL : DEFAULT_ANTHROPIC_AGENT_MODEL),
      limits: session?.limits ?? { ...DEFAULT_DRAWING_AGENT_LIMITS },
      mode: state.mode === "reference" ? "reference" : "model", referenceId: "", sessionId: state.sessionId, sessionStatus: state.status,
    };
  }
  const [prompt, setPrompt] = useState(initial.current.prompt);
  const [mode, setMode] = useState<"model" | "reference">(initial.current.mode);
  const [referenceId, setReferenceId] = useState(initial.current.referenceId);
  const [provider, setProvider] = useState<ModelProvider>(initial.current.provider);
  const [model, setModel] = useState(initial.current.model);
  const [gptConfigured, setGptConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [limits, setLimits] = useState<DrawingAgentLimits>(initial.current.limits);
  const [operationPending, setPending] = useState(false);
  const pending = operationPending || state.settling;
  const pendingCount = useRef(0);
  const references = useAgentReferences(agent);
  const selectedReference = references.references.find(reference => reference.id === referenceId) ?? references.references[0];
  const running = state.status === "running";
  const resumable = mode === "model" && state.mode !== "reference" && ["paused", "error", "limit_reached"].includes(state.status);
  const synchronizedSession = useRef({ id: initial.current.sessionId, status: initial.current.sessionStatus });
  useEffect(() => {
    if (!state.sessionId) return;
    if (synchronizedSession.current.id === state.sessionId && synchronizedSession.current.status === state.status) return;
    synchronizedSession.current = { id: state.sessionId, status: state.status };
    // 公開APIからの開始・再開も、画面の設定へ反映する。
    const session = agent.getSession();
    if (!session) return;
    setMode(session.mode === "reference" ? "reference" : "model");
    if (session.mode === "reference") return;
    setPrompt(session.prompt); setProvider(session.provider); setModel(session.model); setLimits(session.limits);
  }, [agent, state.sessionId, state.status]);
  useEffect(() => {
    panelDrafts.set(agent, { prompt, provider, model, limits, mode, referenceId, sessionId: state.sessionId, sessionStatus: state.status });
  }, [agent, prompt, provider, model, limits, mode, referenceId, state.sessionId, state.status]);
  useEffect(() => {
    if (mode === "reference" || provider !== "openai" || !isTauri()) return;
    let disposed = false;
    void hasGptApiKey().then(value => { if (!disposed) setGptConfigured(value); })
      .catch(e => { if (!disposed) setError(`APIキーを確認できません: ${String(e)}`); });
    return () => { disposed = true; };
  }, [provider, mode]);
  const configured = provider === "openai" ? gptConfigured : claudeAuth.configured;
  const run = async (work: () => Promise<unknown>) => {
    pendingCount.current++; setError(""); setPending(true); onBusyChange(true);
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { pendingCount.current--; setPending(pendingCount.current > 0); onBusyChange(pendingCount.current > 0); }
  };
  const used: Partial<Record<keyof DrawingAgentLimits, number>> = {
    maxIterations: state.usage.iterations, maxModelCalls: state.usage.modelCalls, maxToolCalls: state.usage.toolCalls,
    maxTotalTokens: state.usage.inputTokens + state.usage.outputTokens,
    maxInputTokens: state.usage.inputTokens, maxOutputTokens: state.usage.outputTokens,
  };
  return <section className="section agent-panel" aria-label="AIドロー（β版）" ref={panelRef}>
    <div className="section-title"><span><IconBrush width={12} height={12} style={{ verticalAlign: -2 }} /> AIドロー（β版）</span>{running && <span className="agent-busy-dot" />}</div>
    <div className="agent-panel-status">
      <label>描画方法<select aria-label="描画方法" value={mode} disabled={running || pending} onChange={event => setMode(event.target.value as "model" | "reference")}>
        <option value="model">指示から描く</option><option value="reference">お手本を再描画</option>
      </select></label>
      <AgentProgress state={state} defaultStages={mode === "reference" ? REFERENCE_DRAWING_STAGES : DEFAULT_DRAWING_STAGES} />
      <div className="agent-actions">
        {running && state.mode === "reference" ? null : running ? <Button variant="primary" onClick={() => agent.pause()}>一時停止</Button> : mode === "reference" ?
          <Button variant="primary" disabled={!hasDocument || !selectedReference || pending} onClick={() => void run(async () => {
            if (!selectedReference) return;
            onPlaybackChange(null); await agent.startReference(selectedReference, references.references);
          })}>再描画を開始</Button> : resumable ?
          <Button variant="primary" disabled={pending || !hasDocument || !configured} onClick={() => void run(async () => { onPlaybackChange(null); await agent.resume({ limits, references: references.references }); })}>続きから再開</Button> :
          <Button variant="primary" disabled={!hasDocument || !configured || !prompt.trim() || !model.trim() || pending} onClick={() => void run(async () => {
            onPlaybackChange(null);
            safeSetStorageItem("ai-paint-agent-provider", provider); safeSetStorageItem("ai-paint-agent-model", model);
            await agent.start({ prompt, provider, model: model.trim(), limits, references: references.references });
          })}>{state.sessionId ? "新しい制作を開始" : "描画を開始"}</Button>}
        <Button disabled={!running && !resumable} onClick={() => void run(() => agent.stop())}>中止</Button>
      </div>
      {error && <p className="agent-error" role="alert">{error}</p>}
    </div>
    <div className="agent-panel-body">
      {mode === "model" && <label>描きたい絵<textarea aria-label="描きたい絵" rows={3} value={prompt} disabled={running || pending || resumable} onChange={e => setPrompt(e.target.value)} placeholder="人物、構図、色、画風。お手本のどこに近づけたいか" /></label>}
      {resumable && <small>元の指示・モデルで続行します。お手本と上限は変更できます。</small>}
      <AgentReferences draft={references} disabled={running || pending} run={run} local={mode === "reference"} />
      {mode === "reference" && <>
        {references.references.length > 1 && <label>再描画するお手本<select aria-label="再描画するお手本" value={selectedReference?.id ?? ""} disabled={running || pending} onChange={event => setReferenceId(event.target.value)}>
          {references.references.map(reference => <option key={reference.id} value={reference.id}>{reference.name}</option>)}
        </select></label>}
        <small>APIキー不要。現在のキャンバス中央に、新しいフォルダとレイヤーで描きます。見本は原寸以下・最大768pxで収めます。</small>
      </>}
      {mode === "model" && <><details className="agent-settings"><summary>モデル・APIキー <span>{model}</span></summary>
        <div className="agent-row"><label>提供元<select aria-label="モデル提供元" value={provider} disabled={running || pending || resumable} onChange={e => {
          const next = e.target.value as ModelProvider; setProvider(next); setModel(next === "openai" ? DEFAULT_OPENAI_AGENT_MODEL : DEFAULT_ANTHROPIC_AGENT_MODEL);
        }}><option value="openai">OpenAI / GPT</option><option value="anthropic">Anthropic / Claude</option></select></label></div>
        <label>モデル<input aria-label="モデル" value={model} disabled={running || pending || resumable} onChange={e => setModel(e.target.value)} /></label>
        <label>APIキー（{configured ? "設定済み" : "未設定"}）<input type="password" aria-label="Agent APIキー" autoComplete="off" value={key} disabled={running || pending} onChange={e => setKey(e.target.value)} /></label>
        <div className="agent-row"><Button disabled={!key.trim() || running || pending} onClick={() => void run(async () => {
          if (provider === "openai") setGptConfigured(await setGptApiKey(key.trim()));
          else if (!await claudeAuth.setKey(key.trim())) throw new Error("Claude APIキーを保存できませんでした");
          setKey("");
        })}>キーを保存</Button><Button disabled={!configured || running || pending} onClick={() => void run(async () => {
          if (provider === "openai") { await clearGptApiKey(); setGptConfigured(false); }
          else if (!await claudeAuth.clearKey()) throw new Error("Claude APIキーを削除できませんでした");
        })}>キーを削除</Button></div>
      </details>
      {!isTauri() && <small>モデルへの接続はデスクトップ版で利用できます。</small>}
      {!configured && isTauri() && <small>「モデル・APIキー」でキーを設定してください。</small>}
      <details className="agent-settings" open={state.status === "limit_reached" || undefined}>
        <summary>上限設定 <span>{Math.floor(state.usage.elapsedMs / 60000)} / {limits.maxDurationMs / 60000}分</span></summary>
        <div className="agent-limits"><label>時間（分）<input aria-label="時間上限" type="number" min={1} max={1440} value={limits.maxDurationMs / 60000} disabled={running || pending} onChange={e => setLimits({ ...limits, maxDurationMs: Number(e.target.value) * 60000 })} /></label>
          {limitFields.map(field => <label key={field.key}>{field.title}<input aria-label={`${field.title}上限`} type="number" min={1} max={field.max} value={limits[field.key]} disabled={running || pending}
            onChange={e => setLimits({ ...limits, [field.key]: Number(e.target.value) })} /><small>使用 {used[field.key]?.toLocaleString() ?? 0}</small></label>)}
        </div>
      </details>
      </>}
      <ol className="agent-stages">{(state.stages.length ? state.stages : mode === "reference" ? REFERENCE_DRAWING_STAGES : DEFAULT_DRAWING_STAGES).map((stage, index) => <li key={stage.id} className={index === state.currentStageIndex ? "active" : ""}>
        <strong>{state.stageStates[index]?.status === "completed" ? "✓ " : `${index + 1}. `}{stage.title}</strong>
        {index === state.currentStageIndex && <small>{stage.goal}</small>}
      </li>)}</ol>
      {state.lastMessage && <details className="agent-settings"><summary>直近の作業内容</summary><p className="agent-message">{state.lastMessage}</p></details>}
      <AgentPlayback controller={controller} index={playbackIndex} onChange={onPlaybackChange} />
      <Button disabled={running || pending || !hasDocument} onClick={() => void run(async () => {
        const result = await controller.api.execute("file.save", { format: "aipaint" });
        if (!result.ok) throw new Error(result.error.message);
        if (result.value) pushToast("絵と制作過程を保存しました", "success");
      })}>絵と制作過程を保存</Button>
      {state.sessionId && <small>新しい制作は現在の絵を引き継ぎ、記録を置き換えます。残す記録は先に保存してください。</small>}
      {state.recording.droppedFrames > 0 && <small>記録上限により途中の画像を{state.recording.droppedFrames}枚間引いています。</small>}
      {!hasDocument && <p>キャンバスを作成するか、作品を開いてください。</p>}
      <AgentApiInspector api={controller.api} disabled={running || pending || playbackIndex !== null} />
    </div>
  </section>;
}
