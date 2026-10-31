import { beginStroke, continueStroke } from "../brushEngine";
import { buildReferencePaintPlan, meanAbsoluteError, opaqueReference, ReferencePaintBudgetError, validateReferenceSize } from "./plan";
import type { ReferencePaintPlan, ReferencePaintProgress, ReferenceStroke } from "./types";

// Worker内で試行し、上限に収まった全工程だけを実キャンバスへ渡す。
export function buildAdaptiveReferencePaintPlan(
  image: ImageData,
  onProgress?: (progress: ReferencePaintProgress) => void,
): ReferencePaintPlan {
  const { width, height } = image;
  validateReferenceSize(width, height, image.data.length);
  const source = new OffscreenCanvas(width, height);
  const canvas = new OffscreenCanvas(width, height);
  try {
    const sourceCtx = source.getContext("2d");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx || !ctx) throw new Error("描画検証用Canvasを作成できません");
    const target = opaqueReference(image.data);
    sourceCtx.putImageData(new ImageData(target, width, height), 0, 0);
    const draw = ({ points, settings }: ReferenceStroke) => {
      beginStroke(ctx, points[0], settings);
      for (let i = 1; i < points.length; i += 1) continueStroke(ctx, points[i - 1], points[i], settings);
    };
    const clear = (w: number, h: number) => {
      canvas.width = w; canvas.height = h;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    };
    let planningWidth = width; let planningHeight = height;
    let attempt = 1;
    for (;;) {
      clear(planningWidth, planningHeight);
      let pixels = image.data;
      if (attempt > 1) {
        // 縮小を重ねてぼかさないよう、毎回元画像から読み直す。
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, planningWidth, planningHeight);
        pixels = ctx.getImageData(0, 0, planningWidth, planningHeight).data;
        clear(planningWidth, planningHeight);
      }
      let plan: ReferencePaintPlan;
      try {
        plan = buildReferencePaintPlan(planningWidth, planningHeight, pixels, {
          draw,
          read: () => ctx.getImageData(0, 0, planningWidth, planningHeight).data,
        }, progress => onProgress?.({
          ...progress,
          label: attempt === 1 ? progress.label : `細かさを自動調整（${attempt}回目）: ${progress.label}`,
        }));
      } catch (error) {
        if (!(error instanceof ReferencePaintBudgetError)) throw error;
        const nextWidth = Math.max(1, Math.floor(planningWidth * 0.75));
        const nextHeight = Math.max(1, Math.floor(planningHeight * 0.75));
        if (nextWidth === planningWidth && nextHeight === planningHeight) throw error;
        planningWidth = nextWidth; planningHeight = nextHeight;
        attempt += 1;
        continue;
      }
      if (attempt === 1) return plan;

      // 解析密度だけを下げ、配置に使う画像寸法と筆跡の描画範囲を維持する。
      const scaleX = width / planningWidth; const scaleY = height / planningHeight;
      plan.width = width; plan.height = height;
      plan.planningSize = { width: planningWidth, height: planningHeight };
      clear(width, height);
      let strokes = 0;
      for (const [index, stage] of plan.stages.entries()) {
        for (const stroke of stage.strokes) {
          stroke.points = stroke.points.map(point => ({ ...point, x: point.x * scaleX, y: point.y * scaleY }));
          stroke.settings = { ...stroke.settings, size: stroke.settings.size * Math.max(scaleX, scaleY) };
          draw(stroke);
          strokes += 1;
          if (strokes % 256 === 0) onProgress?.({ label: `調整後の描画を確認: ${stage.label}`, stage: index, stageCount: plan.stages.length, strokes });
        }
        // 拡大後に実際のブラシで再描画し、元画像との誤差を記録する。
        stage.meanAbsoluteError = meanAbsoluteError(target, ctx.getImageData(0, 0, width, height).data);
      }
      return plan;
    }
  } finally {
    source.width = 1; source.height = 1;
    canvas.width = 1; canvas.height = 1;
  }
}
