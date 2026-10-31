import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { Timelapse } from "../../core/Timelapse";
import {
  beginStroke,
  continueStroke,
  StrokeStabilizer,
  type BrushSettings,
  type StrokePoint,
} from "../../core/brushEngine";
import { brushStrokeBounds } from "../../core/brushDynamics";
import { recordDrawingActivity } from "../../core/drawingActivity";
import {
  applyStrokeTransparentLock,
  restoreStrokeSelection,
} from "../../core/brushStrokePostprocess";
import { pushToast } from "../../ui/primitives";
import type { Selection, Tool } from "../../types";

type BrushStrokeTool = "brush" | "eraser";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface UseBrushStrokeSessionParams {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
  stabilizer: number;
  isDrawingRef: MutableRefObject<boolean>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  brushSettingsFor: (tool: BrushStrokeTool) => BrushSettings;
  isAutoBackupBusy?: () => boolean;
}

export function useBrushStrokeSession({
  doc,
  history,
  timelapse,
  selection,
  stabilizer,
  isDrawingRef,
  rendererRef,
  brushSettingsFor,
  isAutoBackupBusy,
}: UseBrushStrokeSessionParams) {
  const lastPointRef = useRef<StrokePoint | null>(null);
  const strokeToolRef = useRef<BrushStrokeTool | null>(null);
  const strokeNeedsPostprocessRef = useRef(false);
  const strokeTransparentLockRef = useRef(false);
  const strokeAmountRef = useRef(0);
  const stabilizerRef = useRef<StrokeStabilizer>(new StrokeStabilizer(stabilizer));

  useEffect(() => {
    stabilizerRef.current.setStrength(stabilizer);
  }, [stabilizer]);

  const startBrushStroke = useCallback(
    (pos: StrokePoint, tool: Tool): boolean => {
      if (tool !== "brush" && tool !== "eraser") return false;
      const layer = doc.getActiveLayer();
      if (!layer || layer.meta.locked || layer.meta.kind === "group") return true;
      // AutoBackup の saveAiPaint 中はストロークを開始しない。await 中にレイヤーを
      // 書き換えると、後段の toPngBytes が半端な状態を PNG 化してバックアップが不整合になる。
      if (isAutoBackupBusy?.()) {
        pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
        return true;
      }
      const settings = brushSettingsFor(tool);
      const initialRect = brushStrokeBounds(pos, pos, settings);
      strokeAmountRef.current = strokeDotAmount(settings.size);
      // region 追跡モード: getImageData での全画素読み戻しを避けつつ、変更領域だけ保存する
      history.beginOperation(doc, [layer.meta.id], {
        trackRegion: true,
        initialRegion: initialRect,
      });
      isDrawingRef.current = true;
      strokeToolRef.current = tool;
      strokeTransparentLockRef.current = !!layer.meta.transparentPixelLock;
      strokeNeedsPostprocessRef.current = selection.kind === "polygon" ||
        selection.kind === "mask" || strokeTransparentLockRef.current;
      stabilizerRef.current.reset();
      const start = stabilizerRef.current.feed(pos);
      lastPointRef.current = start;
      layer.store.withCtx((ctx) => {
        applySelectionClipDirect(ctx as CanvasRenderingContext2D, selection);
        beginStroke(ctx, start, settings);
      }, initialRect);
      if (strokeTransparentLockRef.current) {
        applyStrokeTransparentLock(layer.store, history, layer.meta.id, initialRect);
      }
      rendererRef.current?.invalidate(initialRect);
      return true;
    },
    [
      brushSettingsFor,
      doc,
      history,
      isAutoBackupBusy,
      isDrawingRef,
      rendererRef,
      selection,
    ]
  );

  const continueBrushStroke = useCallback(
    (pos: StrokePoint): boolean => {
      // ストローク途中で tool が切り替わっても、開始時のツールで描画継続する。
      if (!isDrawingRef.current || !lastPointRef.current) return false;
      const strokeTool = strokeToolRef.current;
      if (strokeTool !== "brush" && strokeTool !== "eraser") return false;
      const layer = doc.getActiveLayer();
      if (!layer) return true;
      const settings = brushSettingsFor(strokeTool);
      const stable = stabilizerRef.current.feed(pos);
      const prevPoint = lastPointRef.current;
      // 部分描画: ストローク区間のbboxだけ再合成 (React再renderも回避)。
      // 描画前に rect を計算しておき、withCtx の hint としても渡す
      // (Phase 3 でタイル materialize の絞り込みに使う)。
      const segRect = brushStrokeBounds(prevPoint, stable, settings);
      strokeAmountRef.current += strokeSegmentAmount(prevPoint, stable, settings.size);
      history.expandRegion(segRect);
      layer.store.withCtx((ctx) => {
        applySelectionClipDirect(ctx as CanvasRenderingContext2D, selection);
        continueStroke(ctx, prevPoint, stable, settings);
      }, segRect);
      if (strokeTransparentLockRef.current) {
        applyStrokeTransparentLock(layer.store, history, layer.meta.id, segRect);
      }
      lastPointRef.current = stable;
      rendererRef.current?.invalidate(segRect);
      return true;
    },
    [brushSettingsFor, doc, history, isDrawingRef, rendererRef, selection]
  );

  const finishBrushStroke = useCallback(
    async (pos: StrokePoint | null): Promise<boolean> => {
      if (!isDrawingRef.current) return false;
      isDrawingRef.current = false;
      const strokeTool = strokeToolRef.current;
      const layer = doc.getActiveLayer();
      if (layer && lastPointRef.current && pos && (strokeTool === "brush" || strokeTool === "eraser")) {
        const settings = brushSettingsFor(strokeTool);
        const flushPoints = stabilizerRef.current.flush(pos, 6);
        if (flushPoints.length > 0) {
          const startPrev = lastPointRef.current;
          // flush 全体の影響 bbox を先に算出して hint として渡す
          // (Phase 3 タイル化で必要なタイルだけ materialize する)。
          let flushBbox: Rect | undefined;
          {
            let prev = startPrev;
            for (const p of flushPoints) {
              const r = brushStrokeBounds(prev, p, settings);
              strokeAmountRef.current += strokeSegmentAmount(prev, p, settings.size);
              history.expandRegion(r);
              if (!flushBbox) {
                flushBbox = { x: r.x, y: r.y, w: r.w, h: r.h };
              } else {
                const x1 = Math.min(flushBbox.x, r.x);
                const y1 = Math.min(flushBbox.y, r.y);
                const x2 = Math.max(flushBbox.x + flushBbox.w, r.x + r.w);
                const y2 = Math.max(flushBbox.y + flushBbox.h, r.y + r.h);
                flushBbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
              }
              prev = p;
            }
          }
          layer.store.withCtx((ctx) => {
            applySelectionClipDirect(ctx as CanvasRenderingContext2D, selection);
            let prev = startPrev;
            for (const p of flushPoints) {
              continueStroke(ctx, prev, p, settings);
              prev = p;
            }
          }, flushBbox);
          if (strokeTransparentLockRef.current && flushBbox) {
            applyStrokeTransparentLock(layer.store, history, layer.meta.id, flushBbox);
          }
        }
      }
      lastPointRef.current = null;
      if (layer && strokeNeedsPostprocessRef.current) {
        restoreStrokeSelection(layer.store, history, layer.meta.id, selection, strokeTool === "eraser");
        if (strokeTransparentLockRef.current && selection.kind !== "polygon" && selection.kind !== "mask") {
          const pending = history.getPendingRegion();
          if (pending) applyStrokeTransparentLock(layer.store, history, layer.meta.id, pending);
        }
      }
      if (layer && (strokeToolRef.current === "brush" || strokeToolRef.current === "eraser")) {
        history.commitOperation(doc, "描画", [layer.meta.id]);
        recordDrawingActivity(strokeAmountRef.current);
        // ストローク中は renderer.invalidate(rect) だけで version を bump しなかったので、
        // ここで一度 React に通知して SubView 等を最新に揃える。
        // アクティブ層のピクセルだけが変わっているため bg キャッシュは破棄しない。
        doc.invalidateActive();
        await timelapse.captureIfEnabled(doc);
      }
      strokeAmountRef.current = 0;
      strokeToolRef.current = null;
      strokeTransparentLockRef.current = false;
      strokeNeedsPostprocessRef.current = false;
      return true;
    },
    [brushSettingsFor, doc, history, isDrawingRef, selection, timelapse]
  );

  const cancelBrushStroke = useCallback((): boolean => {
    if (!isDrawingRef.current) return false;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    strokeToolRef.current = null;
    strokeTransparentLockRef.current = false;
    strokeNeedsPostprocessRef.current = false;
    strokeAmountRef.current = 0;
    // ストローク途中で描き込まれたピクセルをストローク前に戻す。
    // 単に cancelOperation だと before タイルは捨てるがレイヤー上の半端な stamp は残り、
    // history entry も無いので undo で消せない宙ぶらりんになる。
    history.rollbackOperation(doc);
    return true;
  }, [doc, history, isDrawingRef]);

  return {
    startBrushStroke,
    continueBrushStroke,
    finishBrushStroke,
    cancelBrushStroke,
  };
}

function strokeDotAmount(brushSize: number): number {
  const r = Math.max(1, brushSize / 2);
  return Math.PI * r * r * 0.5;
}

function strokeSegmentAmount(
  from: StrokePoint,
  to: StrokePoint,
  brushSize: number
): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return distance * Math.max(1, brushSize) * 0.5;
}

// 描画ループから呼ぶ「クリップだけかける」軽量版（compositeWithSelectionと違って一時canvasを使わない高速版）
// ブラシは1点ごとに動くのでマスク再合成は高コスト。簡易にpolygon/rectクリップだけ採用。mask選択はサポート外（描画前にmask境界rectでクリップのみ）。
function applySelectionClipDirect(
  ctx: CanvasRenderingContext2D,
  selection: Selection
): void {
  if (selection.kind === "rect" && selection.w > 0 && selection.h > 0) {
    ctx.beginPath();
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
    ctx.clip();
  } else if (selection.kind === "polygon" && selection.points.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x, selection.points[0].y);
    for (let i = 1; i < selection.points.length; i += 1) {
      ctx.lineTo(selection.points[i].x, selection.points[i].y);
    }
    ctx.closePath();
    ctx.clip();
  } else if (selection.kind === "mask") {
    ctx.beginPath();
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
    ctx.clip();
  }
}
