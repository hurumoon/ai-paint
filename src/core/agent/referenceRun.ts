import { createReferencePaintPlan } from "../referencePainting/client";
import { referenceStrokeBatches, REFERENCE_PAINT_MAX_EDGE, REFERENCE_PAINT_MAX_PIXELS } from "../referencePainting/plan";
import type { DrawingAgentReference } from "./referenceImages";
import type { DrawingAgentStage } from "./session";

export const REFERENCE_DRAWING_STAGES: readonly DrawingAgentStage[] = [
  ["outline", "輪郭の下描き"], ["large", "大きな色面"], ["color", "色の塗り重ね"],
  ["detail", "細部の描き込み"], ["fine", "細い輪郭と色"], ["correction", "見本との差を修正"],
].map(([id, title]) => ({ id, title, goal: "お手本の輪郭と色に沿って筆致を重ねる", completionCriteria: ["予定した筆致を描画し、キャンバス画像を記録する"] }));

export interface ReferenceDrawingProgress {
  phase: "planning" | "drawing";
  completedStrokes: number;
  totalStrokes: number;
}

// APIの画像メタデータを信用して、大きなPNGを先にデコードしない。
export function validateReferencePngSize(reference: DrawingAgentReference): void {
  const header = atob(reference.dataUrl.split(",")[1].slice(0, 44));
  const bytes = Uint8Array.from(header, c => c.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new Error("お手本のPNGが不正です");
  const view = new DataView(bytes.buffer);
  if (view.getUint32(16) !== reference.width || view.getUint32(20) !== reference.height) throw new Error("お手本の実際の画像サイズが指定と一致しません");
}

export async function runReferenceDrawing(options: {
  reference: DrawingAgentReference;
  signal: AbortSignal;
  assertCurrent(): void;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  clearSelection(): Promise<void>;
  capture(reason: "initial" | "observation", stageComplete?: boolean): Promise<void>;
  progress(value: ReferenceDrawingProgress, label: string): void;
  stage(index: number, complete: boolean): void;
}): Promise<void> {
  const { reference, signal, call, assertCurrent } = options;
  assertCurrent();
  const documentState = await call("document.get_state", {}) as { width: number; height: number };
  assertCurrent();
  // Tauriのconnect-srcは通信先を制限するため、data URLもfetchせず直接デコードする。
  const pngBytes = Uint8Array.from(atob(reference.dataUrl.split(",")[1]), character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
  let source: ImageData;
  try {
    assertCurrent();
    if (bitmap.width !== reference.width || bitmap.height !== reference.height) throw new Error("お手本の画像サイズが不正です");
    const scale = Math.min(1, documentState.width / bitmap.width, documentState.height / bitmap.height,
      REFERENCE_PAINT_MAX_EDGE / Math.max(bitmap.width, bitmap.height), Math.sqrt(REFERENCE_PAINT_MAX_PIXELS / (bitmap.width * bitmap.height)));
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(bitmap.width * scale)), Math.max(1, Math.floor(bitmap.height * scale)));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("お手本の画像を読み込めません");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    source = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 1;
  } finally { bitmap.close(); }
  const plan = await createReferencePaintPlan(source, { signal, onProgress: progress => {
    options.progress({ phase: "planning", completedStrokes: 0, totalStrokes: progress.strokes }, `解析中: ${progress.label} / ${progress.strokes.toLocaleString()}筆`);
  } });
  assertCurrent();
  const totalStrokes = plan.stages.reduce((sum, stage) => sum + stage.strokes.length, 0);
  let completedStrokes = 0;
  const x = Math.floor((documentState.width - plan.width) / 2);
  const y = Math.floor((documentState.height - plan.height) / 2);
  await options.capture("initial");
  // 既存の絵・フォルダのピクセルには触らず、独立した最上位フォルダに重ねる。
  const group = await call("layer.add_group", { name: `見本再描画: ${reference.name}` }) as { layerId: string };
  const layerState = await call("document.get_state", {}) as { layers: { id: string; parentId?: string }[] };
  if (layerState.layers[layerState.layers.length - 1]?.id !== group.layerId || layerState.layers.find(layer => layer.id === group.layerId)?.parentId) {
    await call("layer.reorder", { layerId: group.layerId, parentId: null });
  }
  await call("layer.set_active", { layerId: group.layerId });
  try {
    await call("selection.set", { kind: "rect", x, y, width: plan.width, height: plan.height });
    await call("layer.add", { name: "見本の白背景" });
    await call("drawing.path", { commands: [{ op: "move", x, y }, { op: "line", x: x + plan.width, y },
      { op: "line", x: x + plan.width, y: y + plan.height }, { op: "line", x, y: y + plan.height }, { op: "close" }],
      fillColor: plan.background, strokeColor: plan.background, strokeWidth: 1, fill: true, stroke: false });
    for (const [index, stage] of plan.stages.entries()) {
      assertCurrent();
      options.stage(index, false);
      await call("layer.add", { name: stage.label });
      for (const batch of referenceStrokeBatches(stage.strokes)) {
        assertCurrent();
        options.progress({ phase: "drawing", completedStrokes, totalStrokes }, `描画中: ${stage.label} / ${completedStrokes.toLocaleString()} / ${totalStrokes.toLocaleString()}筆`);
        await call("drawing.stroke_batch", { label: `見本再描画: ${stage.label}`, strokes: batch.map(stroke => ({
          ...stroke, points: stroke.points.map(point => ({ ...point, x: point.x + x, y: point.y + y })),
        })) });
        completedStrokes += batch.length;
        options.progress({ phase: "drawing", completedStrokes, totalStrokes }, `描画中: ${stage.label} / ${completedStrokes.toLocaleString()} / ${totalStrokes.toLocaleString()}筆`);
        await options.capture("observation");
        // メインスレッドへ制御を戻し、中止とキャンバスの描画更新を受け付ける。
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      await options.capture("observation", true);
      options.stage(index, true);
    }
  } finally {
    // 中止後も一時的なクリップ範囲を残さない。対象タブの確認は呼び出し元で行う。
    await options.clearSelection();
  }
}
