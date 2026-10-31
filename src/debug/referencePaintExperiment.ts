import { zipSync, strToU8 } from "fflate";
import { createReferencePaintPlan } from "../core/referencePainting/client";
import { meanAbsoluteError, opaqueReference, referenceStrokeBatches, REFERENCE_PAINT_MAX_EDGE, REFERENCE_PAINT_MAX_PIXELS } from "../core/referencePainting/plan";
import type { ReferencePaintPlan } from "../core/referencePainting/types";
import type { PaintApiExecuteResult } from "../core/paintApi";

interface Frame { stage: string; strokes: number; dataUrl: string }
interface Evidence {
  width: number; height: number; source: string; final: string; projectDataUrl: string;
  frames: Frame[]; plan: ReferencePaintPlan;
  metrics: { planningMs: number; paintingMs: number; strokes: number; batches: number; maxBatchMs: number; meanAbsoluteError: number; workerError: number };
}
interface PaintFacade { execute(name: string, args?: Record<string, unknown>): Promise<PaintApiExecuteResult> }
declare global { interface Window { referencePaintExperiment?: { evidence(): Evidence | null } } }

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const iframe = element<HTMLIFrameElement>("paint-app");
const run = element<HTMLButtonElement>("run");
const stop = element<HTMLButtonElement>("stop");
const file = element<HTMLInputElement>("file");
const status = element<HTMLDivElement>("status");
const progress = element<HTMLProgressElement>("progress");
const seek = element<HTMLInputElement>("seek");
const play = element<HTMLButtonElement>("play");
const live = element<HTMLButtonElement>("live");
const png = element<HTMLButtonElement>("png");
const bundle = element<HTMLButtonElement>("bundle");
let facade: PaintFacade;
let target: ImageData | null = null;
let referenceUrl = "";
let controller: AbortController | null = null;
let evidence: Evidence | null = null;
let frames: Frame[] = [];
let playbackTimer: ReturnType<typeof setInterval> | undefined;
window.referencePaintExperiment = { evidence: () => evidence };

const call = async <T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const result = await facade.execute(name, args);
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value as T;
};
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

async function waitForApp(): Promise<void> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const api = iframe.contentWindow?.aiPaint;
    if (api) { facade = api; status.textContent = "完成見本を選択してください"; return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("ai-paint の起動を確認できませんでした");
}

async function loadReference(blob: Blob, crop?: { x: number; y: number; w: number; h: number }): Promise<void> {
  if (blob.size > 20 * 1024 * 1024) throw new Error("画像ファイルは20MB以下にしてください");
  const bitmap = await createImageBitmap(blob);
  try {
    const box = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1 || box.x + box.w > bitmap.width || box.y + box.h > bitmap.height) throw new Error("画像の切り出し範囲が不正です");
    const scale = Math.min(1, REFERENCE_PAINT_MAX_EDGE / Math.max(box.w, box.h), Math.sqrt(REFERENCE_PAINT_MAX_PIXELS / (box.w * box.h)));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.floor(box.w * scale)); canvas.height = Math.max(1, Math.floor(box.h * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
    target = ctx.getImageData(0, 0, canvas.width, canvas.height);
    endPlayback(); evidence = null; frames = [];
    png.disabled = bundle.disabled = play.disabled = live.disabled = seek.disabled = true;
    element("stages").replaceChildren(); element("metrics").textContent = ""; progress.value = 0;
    referenceUrl = canvas.toDataURL("image/png");
    const img = element<HTMLImageElement>("reference"); img.src = referenceUrl; img.hidden = false;
    element("source-info").textContent = `${canvas.width} × ${canvas.height}px${crop ? " / 添付画面から絵を切り出し" : ""}`;
    run.disabled = false;
    status.textContent = "見本を読み込みました";
    canvas.width = canvas.height = 1;
  } finally { bitmap.close(); }
}

file.onchange = () => {
  const selected = file.files?.[0];
  if (selected) void loadReference(selected).catch(showError);
};

function endPlayback(): void {
  clearInterval(playbackTimer); playbackTimer = undefined;
  element("replay").style.display = "none";
  play.textContent = "工程を再生";
}

function showFrame(index: number): void {
  const frame = frames[index]; if (!frame) return;
  element<HTMLImageElement>("replay-image").src = frame.dataUrl;
  element("replay").style.display = "flex";
  seek.value = String(index);
  status.textContent = `再生: ${frame.stage} / ${frame.strokes.toLocaleString()}筆`;
}

seek.oninput = () => { clearInterval(playbackTimer); playbackTimer = undefined; play.textContent = "工程を再生"; showFrame(Number(seek.value)); };
live.onclick = () => { endPlayback(); status.textContent = "ai-paint のキャンバスを表示しています"; };
play.onclick = () => {
  if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = undefined; play.textContent = "工程を再生"; return; }
  let index = 0;
  showFrame(index); play.textContent = "再生を止める";
  playbackTimer = setInterval(() => {
    if (++index >= frames.length) { clearInterval(playbackTimer); playbackTimer = undefined; play.textContent = "工程を再生"; return; }
    showFrame(index);
  }, 300);
};
stop.onclick = () => { controller?.abort(); stop.disabled = true; status.textContent = "現在の描画を終えて中止します"; };

run.onclick = () => { void executeExperiment().catch(showError); };
async function executeExperiment(): Promise<void> {
  if (!target || controller) return;
  const source = target;
  const sourceUrl = referenceUrl;
  controller = new AbortController();
  const signal = controller.signal;
  endPlayback(); evidence = null; frames = [];
  run.disabled = file.disabled = true; stop.disabled = false;
  png.disabled = bundle.disabled = play.disabled = live.disabled = seek.disabled = true;
  element("stages").replaceChildren(); element("metrics").textContent = "";
  progress.value = 0;
  const planningStart = performance.now();
  try {
    const plan = await createReferencePaintPlan(source, { signal, onProgress: info => {
      status.textContent = `解析中: ${info.label} / ${info.strokes.toLocaleString()}筆`;
      progress.value = info.stage / info.stageCount * 35;
    } });
    const planningMs = performance.now() - planningStart;
    if (signal.aborted) return;
    await call("tabs.create", { width: source.width, height: source.height });
    const state = await call<{ activeTabId: string }>("app.get_state");
    const boundTabId = state.activeTabId;
    await nextFrame();
    const canvasArea = iframe.contentDocument?.querySelector<HTMLElement>(".canvas-area");
    const zoom = Math.min(2.5, ((canvasArea?.clientWidth ?? iframe.clientWidth - 360) - 40) / source.width, ((canvasArea?.clientHeight ?? iframe.clientHeight - 140) - 40) / source.height);
    await call("view.update", { zoom: Math.max(0.1, zoom), pan: { x: 0, y: 0 }, rotation: 0, canvasFlipped: false });
    await call("selection.set", { kind: "none" });
    // iframeは実アプリ。操作中の手描きやタブ切替だけを抑え、同じキャンバスにAPIで描く。
    iframe.style.pointerEvents = "none";
    const childApp = iframe.contentDocument?.querySelector<HTMLElement>(".app");
    childApp?.setAttribute("inert", "");
    const total = plan.stages.reduce((sum, stage) => sum + stage.strokes.length, 0);
    const paintingStart = performance.now();
    let strokes = 0; let batches = 0;
    const capture = async (stage: string) => {
      const image = await call<{ dataUrl: string }>("document.get_image", { maxEdge: Math.max(source.width, source.height) });
      frames.push({ stage, strokes, dataUrl: image.dataUrl });
    };
    try {
      await call("drawing.fill", { x: 0, y: 0, color: plan.background, tolerance: 0 });
      await capture("白紙");
      let maxBatchMs = 0;
      for (const stage of plan.stages) {
        await call("layer.add", { name: stage.label });
        for (const batch of referenceStrokeBatches(stage.strokes)) {
          if (signal.aborted) throw new DOMException("中止しました", "AbortError");
          const current = await call<{ activeTabId: string }>("app.get_state");
          if (current.activeTabId !== boundTabId) throw new Error("対象のキャンバスが切り替わりました");
          const batchStart = performance.now();
          await call("drawing.stroke_batch", { strokes: batch, label: `見本再描画: ${stage.label}` });
          maxBatchMs = Math.max(maxBatchMs, performance.now() - batchStart);
          strokes += batch.length; batches += 1;
          status.textContent = `描画中: ${stage.label} / ${strokes.toLocaleString()} / ${total.toLocaleString()}筆`;
          progress.value = 35 + strokes / Math.max(1, total) * 65;
          await capture(stage.label);
          await nextFrame();
        }
        await capture(stage.label);
        const frameIndex = frames.length - 1;
        const item = document.createElement("li"); const button = document.createElement("button");
        button.textContent = `${stage.label} (${stage.strokes.length.toLocaleString()}筆)`;
        button.onclick = () => { if (!controller) showFrame(frameIndex); }; item.append(button); element("stages").append(item);
      }
      const paintingMs = performance.now() - paintingStart;
      const final = frames[frames.length - 1].dataUrl;
      const painted = await pixelsFromDataUrl(final);
      const error = meanAbsoluteError(opaqueReference(source.data), painted.data);
      const exported = await call<{ dataUrl: string }>("file.export", { format: "aipaint" });
      if (signal.aborted) throw new DOMException("中止しました", "AbortError");
      evidence = { width: source.width, height: source.height, source: sourceUrl, final, projectDataUrl: exported.dataUrl, frames, plan,
        metrics: { planningMs, paintingMs, strokes, batches, maxBatchMs, meanAbsoluteError: error, workerError: plan.stages[plan.stages.length - 1].meanAbsoluteError } };
      status.textContent = "完了: 見本をブラシ操作だけで再描画しました";
      progress.value = 100;
      element("metrics").textContent = `解析 ${(planningMs / 1000).toFixed(1)}秒 / 描画 ${(paintingMs / 1000).toFixed(1)}秒\n${strokes.toLocaleString()}筆 / ${batches}回のAPI描画\n平均色差 ${error.toFixed(2)} / 255（小さいほど近い）`;
      seek.max = String(frames.length - 1); seek.value = seek.max;
      png.disabled = bundle.disabled = play.disabled = live.disabled = seek.disabled = false;
    } finally { childApp?.removeAttribute("inert"); iframe.style.pointerEvents = ""; }
  } finally { controller = null; run.disabled = !target; file.disabled = false; stop.disabled = true; }
}

async function pixelsFromDataUrl(dataUrl: string): Promise<ImageData> {
  const blob = await (await fetch(dataUrl)).blob(); const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
png.onclick = () => { if (evidence) void fetch(evidence.final).then(r => r.blob()).then(blob => download(blob, "reference-painted.png")); };
bundle.onclick = () => { void exportBundle().catch(showError); };

async function exportBundle(): Promise<void> {
  if (!evidence) return;
  const data = evidence;
  bundle.disabled = true;
  try {
    const files: Record<string, Uint8Array> = {
      "strokes.json": strToU8(JSON.stringify(data.plan)),
      "metrics.json": strToU8(JSON.stringify(data.metrics, null, 2)),
      "replay.html": strToU8(replayHtml(data)),
    };
    for (const [name, url] of [["reference.png", data.source], ["painted.png", data.final], ["painted.aipaint", data.projectDataUrl]]) files[name] = new Uint8Array(await (await fetch(url)).arrayBuffer());
    for (const stage of data.plan.stages) {
      const frame = [...data.frames].reverse().find(frame => frame.stage === stage.label);
      if (frame) files[`stages/${stage.id}.png`] = new Uint8Array(await (await fetch(frame.dataUrl)).arrayBuffer());
    }
    download(new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), "reference-paint-experiment.zip");
  } finally { bundle.disabled = false; }
}

function replayHtml(data: Evidence): string {
  const framesJson = JSON.stringify(data.frames).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>見本から再描画・検証結果</title><style>body{font:14px system-ui;background:#eef1f5;color:#243247;margin:24px}main{display:flex;gap:24px;justify-content:center}img{max-height:75vh;max-width:44vw;image-rendering:auto}button,input{margin:8px}p{color:#506277}</style><h2>見本から再描画 / ai-paint</h2><p>左:完成見本 / 右:既存ブラシAPIで描いた結果。元の画像生成過程ではなく、再描画の実行記録です。</p><main><div><img src="${data.source}" alt="完成見本"></div><div><img id="output" src="${data.final}" alt="再描画"></div></main><button id="play">再生</button><input id="seek" type="range" min="0" max="${data.frames.length - 1}" value="${data.frames.length - 1}" style="width:60%"><p id="label">${data.metrics.strokes.toLocaleString()}筆 / 平均色差 ${data.metrics.meanAbsoluteError.toFixed(2)} / 255</p><script>const frames=${framesJson};const seek=document.getElementById('seek'),img=document.getElementById('output'),label=document.getElementById('label'),button=document.getElementById('play');let timer;function show(i){seek.value=i;img.src=frames[i].dataUrl;label.textContent=frames[i].stage+' / '+frames[i].strokes+'筆'}seek.oninput=()=>{clearInterval(timer);timer=null;button.textContent='再生';show(+seek.value)};button.onclick=()=>{if(timer){clearInterval(timer);timer=null;button.textContent='再生';return}let i=0;show(i);button.textContent='停止';timer=setInterval(()=>{if(++i>=frames.length){clearInterval(timer);timer=null;button.textContent='再生'}else show(i)},300)};</script></html>`;
}

function showError(error: unknown): void { status.textContent = error instanceof Error ? error.message : String(error); }

void waitForApp().then(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get("sample") === "miku") {
    const response = await fetch("/ui-snapshots/reference-paint/input.png");
    if (!response.ok) throw new Error("試作用の添付画像がありません。ファイルから選択してください");
    await loadReference(await response.blob(), { x: 100, y: 67, w: 282, h: 318 });
    if (params.get("auto") === "1") await executeExperiment();
  }
}).catch(showError);
