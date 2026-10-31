import {
  beginStroke,
  continueStroke,
  StrokeStabilizer,
  type BrushSettings,
  type StrokePoint,
} from "../brushEngine";
import { brushStrokeBounds } from "../brushDynamics";
import {
  applyAdjustment,
  blendWithMask,
  buildCurveLUT,
  buildLevelsLUT,
  buildSelectionMaskAlpha,
  type ColorAdjustment,
} from "../colorAdjust";
import { compositeLayers } from "../composite";
import { recordDrawingActivity } from "../drawingActivity";
import {
  applyBlur,
  applyGradient,
  commitShape,
  hexToRgba,
  selectionBBox,
  type ShapeParams,
} from "../toolHandlers";
import { applyTransparentPixelLock } from "../transparentPixelLock";
import { TileStore } from "../TileStore";
import { floodFillWorker } from "../../workers/paintWorkerClient";
import type { Selection } from "../../types";
import { requireActiveDrawable, requireState, throwIfAborted } from "./helpers";
import type { PaintApi } from "./PaintApi";
import { brushKinds, colorSchema, enumSchema, objectSchema, pointSchema } from "./schemas";
import { PaintApiFault, type SerializableBrushSettings } from "./types";

interface Rect { x: number; y: number; w: number; h: number }

const brushSettingsSchema = objectSchema({
  kind: enumSchema([...brushKinds, "eraser-round", "eraser-hard", "eraser-soft"]),
  size: { type: "number", minimum: 0.1, maximum: 2000 },
  opacity: { type: "number", minimum: 0, maximum: 1 },
  color: colorSchema,
  pressureSize: { type: "number", minimum: 0, maximum: 1 },
  pressureOpacity: { type: "number", minimum: 0, maximum: 1 },
  antiAliasStrength: { type: "number", minimum: 0, maximum: 1 },
  stabilizer: { type: "number", minimum: 0, maximum: 0.95 },
  customBrushId: { type: "string", minLength: 1, maxLength: 200 },
  pressureCurve: objectSchema({
    points: { type: "array", minItems: 1, maxItems: 32, items: objectSchema({
      x: { type: "number", minimum: 0, maximum: 1 },
      y: { type: "number", minimum: 0, maximum: 1 },
    }, ["x", "y"]) },
  }, ["points"]),
}, ["kind", "size", "opacity", "color"]);

const strokeSchema = objectSchema({
  points: { type: "array", minItems: 1, maxItems: 10000, items: pointSchema },
  settings: brushSettingsSchema,
}, ["points", "settings"]);

export function registerDrawingTools(api: PaintApi): void {
  api.register({
    name: "drawing.stroke",
    description: "既存ブラシエンジンで点列を描画します。全ブラシ種、筆圧、補正、筆圧カーブを指定できます。",
    parameters: strokeSchema,
    mutates: true,
    usage: "座標はキャンバス座標、pressure は0..1です。custom には customBrushId が必要です。",
  }, async (args, { app, signal }) => {
    return performStroke(args, app, signal);
  });

  api.register({
    name: "drawing.stroke_batch",
    description: "独立した複数の既存ブラシ筆致を、1回の履歴操作として描画します。",
    parameters: objectSchema({
      strokes: { type: "array", minItems: 1, maxItems: 1024, items: strokeSchema },
      label: { type: "string", minLength: 1, maxLength: 200 },
    }, ["strokes"]),
    mutates: true,
    usage: "筆致どうしは接続されません。合計点数は 32,768 点までです。",
  }, async (args, { app, signal }) => {
    return performStrokeBatch(args, app, signal);
  });

  api.register({
    name: "drawing.erase",
    description: "既存ブラシエンジンの消しゴムで点列を消去します。",
    parameters: objectSchema({
      points: { type: "array", minItems: 1, maxItems: 10000, items: pointSchema },
      kind: enumSchema(["round", "hard", "soft"]),
      size: { type: "number", minimum: 0.1, maximum: 2000 },
      opacity: { type: "number", minimum: 0, maximum: 1 },
      pressureSize: { type: "number", minimum: 0, maximum: 1 },
      pressureOpacity: { type: "number", minimum: 0, maximum: 1 },
      stabilizer: { type: "number", minimum: 0, maximum: 0.95 },
    }, ["points", "kind", "size", "opacity"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const settings = Object.fromEntries(Object.entries({
      kind: `eraser-${args.kind}`,
      size: args.size,
      opacity: args.opacity,
      color: "#000000",
      pressureSize: args.pressureSize,
      pressureOpacity: args.pressureOpacity,
      stabilizer: args.stabilizer,
    }).filter(([, value]) => value !== undefined));
    return performStroke({ points: args.points, settings }, app, signal);
  });

  api.register({
    name: "drawing.shape",
    description: "矩形、楕円、直線、星形を既存図形エンジンで描画します。",
    parameters: objectSchema({
      kind: enumSchema(["rect", "ellipse", "line", "polygon"]),
      x1: { type: "number" }, y1: { type: "number" },
      x2: { type: "number" }, y2: { type: "number" },
      fillColor: colorSchema, strokeColor: colorSchema,
      strokeWidth: { type: "number", minimum: 0.1, maximum: 2000 },
      fill: { type: "boolean" }, stroke: { type: "boolean" },
    }, ["kind", "x1", "y1", "x2", "y2", "fillColor", "strokeColor", "strokeWidth", "fill", "stroke"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    requireActiveDrawable(doc);
    if (!(args.fill as boolean) && !(args.stroke as boolean)) {
      throw new PaintApiFault("INVALID_ARGUMENT", "fill または stroke を有効にしてください");
    }
    if (Math.abs((args.x2 as number) - (args.x1 as number)) < 1 && Math.abs((args.y2 as number) - (args.y1 as number)) < 1) {
      throw new PaintApiFault("INVALID_ARGUMENT", "図形の幅または高さが必要です");
    }
    throwIfAborted(signal);
    const params: ShapeParams = {
      kind: args.kind as ShapeParams["kind"], x1: args.x1 as number, y1: args.y1 as number,
      x2: args.x2 as number, y2: args.y2 as number, color: args.fillColor as string,
      strokeColor: args.strokeColor as string, strokeWidth: args.strokeWidth as number,
      fill: args.fill as boolean, stroke: args.stroke as boolean,
    };
    await commitShape(doc, history, timelapse, params, selection);
    return { changed: true, layerId: doc.activeLayerId };
  });

  registerPathTool(api);
  registerFillTool(api);
  registerGradientTool(api);
  registerBlurTool(api);
  registerColorAdjustmentTool(api);
}

async function performStroke(
  args: Record<string, unknown>,
  app: import("./types").PaintApiContext,
  signal?: AbortSignal
): Promise<unknown> {
  const { doc, history, timelapse, selection } = requireState(app);
  const layer = requireActiveDrawable(doc);
  const prepared = await prepareStroke(args, app, doc.width, doc.height, signal);
  if (!prepared.bbox) return { changed: false };
  await applyRasterMutation({ doc, history, timelapse, selection, layer, bbox: prepared.bbox, label: "API 描画", signal }, (ctx) => {
    drawPreparedStroke(ctx, prepared);
  });
  return { changed: true, layerId: layer.meta.id, bounds: prepared.bbox };
}

interface PreparedStroke {
  points: StrokePoint[];
  settings: BrushSettings;
  bbox: Rect | null;
}

async function performStrokeBatch(
  args: Record<string, unknown>,
  app: import("./types").PaintApiContext,
  signal?: AbortSignal
): Promise<unknown> {
  const { doc, history, timelapse, selection } = requireState(app);
  const layer = requireActiveDrawable(doc);
  const strokes = args.strokes as Record<string, unknown>[];
  const pointCount = strokes.reduce((total, stroke) => total + (stroke.points as unknown[]).length, 0);
  if (pointCount > 32768) {
    throw new PaintApiFault("INVALID_ARGUMENT", "筆致の合計点数は 32,768 点までです");
  }

  // カスタムブラシを含め、すべてを先に解決する。途中失敗で一部だけ描かないため。
  const prepared = await Promise.all(strokes.map(stroke => prepareStroke(stroke, app, doc.width, doc.height, signal)));
  throwIfAborted(signal);
  const bbox = prepared.reduce<Rect | null>((current, stroke) => {
    if (!stroke.bbox) return current;
    return current ? unionRect(current, stroke.bbox) : stroke.bbox;
  }, null);
  if (!bbox) return { changed: false };

  // union bbox は返却値だけに使い、画像と履歴は筆致が触る範囲に限定する。
  const staged = new TileStore(doc.width, doc.height);
  const canvas = document.createElement("canvas");
  let writing = false;
  history.beginOperation(doc, [layer.meta.id], { trackRegion: true });
  try {
    for (const stroke of prepared) {
      if (stroke.bbox) history.expandRegion(stroke.bbox);
    }
    history.forEachPendingBeforeTile(layer.meta.id, null, (before, rect) => {
      staged.putImageData(before, rect.x, rect.y);
    });
    for (const stroke of prepared) {
      const rect = stroke.bbox;
      if (!rect) continue;
      throwIfAborted(signal);
      canvas.width = rect.w; canvas.height = rect.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context を作成できません");
      ctx.putImageData(staged.getImageData(rect.x, rect.y, rect.w, rect.h), 0, 0);
      ctx.translate(-rect.x, -rect.y);
      drawPreparedStroke(ctx, stroke);
      staged.putImageData(ctx.getImageData(0, 0, rect.w, rect.h), rect.x, rect.y);
    }
    // 重なった筆致にもマスク・透明ロックを一度だけ適用する既存の意味を保つ。
    history.forEachPendingBeforeTile(layer.meta.id, null, (before, rect) => {
      const after = staged.getImageData(rect.x, rect.y, rect.w, rect.h);
      const mask = buildSelectionMaskAlpha(selection, rect, doc.width, doc.height);
      blendWithMask(before, after, mask);
      if (layer.meta.transparentPixelLock) applyTransparentPixelLock(before, after);
      staged.putImageData(after, rect.x, rect.y);
    });
    throwIfAborted(signal);
    writing = true;
    history.forEachPendingBeforeTile(layer.meta.id, null, (_before, rect) => {
      layer.store.putImageData(staged.getImageData(rect.x, rect.y, rect.w, rect.h), rect.x, rect.y);
    });
    doc.invalidateActive();
    history.commitOperation(doc, (args.label as string | undefined) ?? "API 一括描画", [layer.meta.id]);
  } catch (error) {
    if (writing) {
      history.forEachPendingBeforeTile(layer.meta.id, null, (before, rect) => {
        layer.store.putImageData(before, rect.x, rect.y);
      });
      doc.invalidateActive();
    }
    history.cancelOperation();
    throw error;
  } finally {
    canvas.width = 0; canvas.height = 0;
    staged.clearRect(0, 0, doc.width, doc.height);
  }
  // 離れた筆致の間の空白を制作量に含めない。重複は許容する推定量とする。
  const drawingAmount = prepared.reduce((total, stroke) =>
    total + (stroke.bbox ? stroke.bbox.w * stroke.bbox.h : 0), 0);
  recordDrawingActivity(drawingAmount);
  await timelapse.captureIfEnabled(doc);
  return { changed: true, layerId: layer.meta.id, bounds: bbox, strokeCount: prepared.length };
}

async function prepareStroke(
  args: Record<string, unknown>,
  app: import("./types").PaintApiContext,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<PreparedStroke> {
  const points = (args.points as Array<{ x: number; y: number; pressure?: number }>).map(
    (point): StrokePoint => ({ x: point.x, y: point.y, pressure: point.pressure ?? 0.5 })
  );
  const serializable = args.settings as SerializableBrushSettings & { stabilizer?: number };
  const settings: BrushSettings = { ...serializable };
  if (serializable.kind === "custom") {
    if (!serializable.customBrushId || !app.resolveCustomBrush) {
      throw new PaintApiFault("INVALID_ARGUMENT", "custom ブラシには解決可能な customBrushId が必要です");
    }
    const custom = await app.resolveCustomBrush(serializable.customBrushId);
    if (!custom) throw new PaintApiFault("INVALID_ARGUMENT", "カスタムブラシが見つかりません");
    settings.custom = custom;
  }
  throwIfAborted(signal);
  const stabilizer = new StrokeStabilizer(serializable.stabilizer ?? 0);
  const stablePoints: StrokePoint[] = [];
  for (const point of points) stablePoints.push(stabilizer.feed(point));
  if ((serializable.stabilizer ?? 0) > 0 && points.length > 1) {
    stablePoints.push(...stabilizer.flush(points[points.length - 1]));
  }
  return { points: stablePoints, settings, bbox: strokeBounds(stablePoints, settings, width, height) };
}

function drawPreparedStroke(ctx: CanvasRenderingContext2D, stroke: PreparedStroke): void {
  if (stroke.points.length === 0) return;
  beginStroke(ctx, stroke.points[0], stroke.settings);
  for (let i = 1; i < stroke.points.length; i += 1) {
    continueStroke(ctx, stroke.points[i - 1], stroke.points[i], stroke.settings);
  }
}

function registerPathTool(api: PaintApi): void {
  const commandSchema = {
    anyOf: [
      objectSchema({ op: { type: "string", enum: ["move", "line"] }, x: { type: "number" }, y: { type: "number" } }, ["op", "x", "y"]),
      objectSchema({ op: { type: "string", enum: ["quadratic"] }, cpx: { type: "number" }, cpy: { type: "number" }, x: { type: "number" }, y: { type: "number" } }, ["op", "cpx", "cpy", "x", "y"]),
      objectSchema({ op: { type: "string", enum: ["bezier"] }, cp1x: { type: "number" }, cp1y: { type: "number" }, cp2x: { type: "number" }, cp2y: { type: "number" }, x: { type: "number" }, y: { type: "number" } }, ["op", "cp1x", "cp1y", "cp2x", "cp2y", "x", "y"]),
      objectSchema({ op: { type: "string", enum: ["close"] } }, ["op"]),
    ],
  };
  api.register({
    name: "drawing.path",
    description: "直線、二次曲線、ベジェ曲線からなる自由なパスを描画します。",
    parameters: objectSchema({
      commands: { type: "array", minItems: 2, maxItems: 5000, items: commandSchema },
      fillColor: colorSchema, strokeColor: colorSchema,
      strokeWidth: { type: "number", minimum: 0.1, maximum: 2000 },
      fill: { type: "boolean" }, stroke: { type: "boolean" },
      lineCap: enumSchema(["butt", "round", "square"]),
      lineJoin: enumSchema(["bevel", "round", "miter"]),
    }, ["commands", "fillColor", "strokeColor", "strokeWidth", "fill", "stroke"]),
    mutates: true,
    usage: "最初のコマンドは move にします。滑らかな輪郭には bezier を使います。",
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    const layer = requireActiveDrawable(doc);
    if (!(args.fill as boolean) && !(args.stroke as boolean)) {
      throw new PaintApiFault("INVALID_ARGUMENT", "fill または stroke を有効にしてください");
    }
    const commands = args.commands as PathCommand[];
    if (commands[0].op !== "move") throw new PaintApiFault("INVALID_ARGUMENT", "最初のパスコマンドは move が必要です");
    const bbox = pathBounds(commands, args.stroke as boolean ? args.strokeWidth as number : 0, doc.width, doc.height);
    if (!bbox) return { changed: false };
    await applyRasterMutation({ doc, history, timelapse, selection, layer, bbox, label: "API パス描画", signal }, (ctx) => {
      ctx.beginPath();
      for (const command of commands) applyPathCommand(ctx, command);
      ctx.lineWidth = args.strokeWidth as number;
      ctx.lineCap = (args.lineCap as CanvasLineCap | undefined) ?? "round";
      ctx.lineJoin = (args.lineJoin as CanvasLineJoin | undefined) ?? "round";
      if (args.fill as boolean) { ctx.fillStyle = args.fillColor as string; ctx.fill(); }
      if (args.stroke as boolean) { ctx.strokeStyle = args.strokeColor as string; ctx.stroke(); }
    });
    return { changed: true, layerId: layer.meta.id, bounds: bbox };
  });
}

function registerFillTool(api: PaintApi): void {
  api.register({
    name: "drawing.fill",
    description: "既存の Worker 塗りつぶし処理で連続領域を塗ります。",
    parameters: objectSchema({
      x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
      color: colorSchema, alpha: { type: "integer", minimum: 0, maximum: 255 },
      tolerance: { type: "number", minimum: 0, maximum: 442 },
      gapClose: { type: "integer", minimum: 0, maximum: 16 },
      expand: { type: "integer", minimum: 0, maximum: 16 },
      reference: enumSchema(["active", "composite"]),
    }, ["x", "y", "color", "tolerance"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    const layer = requireActiveDrawable(doc);
    const x = args.x as number; const y = args.y as number;
    if (x >= doc.width || y >= doc.height) throw new PaintApiFault("INVALID_ARGUMENT", "塗りつぶし開始点がキャンバス外です");
    if (!isPointSelected(x, y, selection, doc.width, doc.height)) {
      throw new PaintApiFault("INVALID_ARGUMENT", "塗りつぶし開始点が選択範囲外です");
    }
    history.beginOperation(doc, [layer.meta.id]);
    try {
      const before = layer.store.getImageData(0, 0, doc.width, doc.height);
      let reference: ImageData | undefined;
      if (args.reference === "composite") {
        const canvas = document.createElement("canvas"); canvas.width = doc.width; canvas.height = doc.height;
        const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
        compositeLayers(ctx, doc, doc.layers, undefined);
        reference = ctx.getImageData(0, 0, doc.width, doc.height);
      }
      const filled = await floodFillWorker(before, x, y, hexToRgba(args.color as string, (args.alpha as number | undefined) ?? 255), args.tolerance as number, {
        gapClose: (args.gapClose as number | undefined) ?? 0,
        expand: (args.expand as number | undefined) ?? 0,
        refImageData: reference,
      });
      const mask = buildSelectionMaskAlpha(selection, { x: 0, y: 0, w: doc.width, h: doc.height }, doc.width, doc.height);
      blendWithMask(before, filled, mask);
      if (layer.meta.transparentPixelLock) applyTransparentPixelLock(before, filled);
      throwIfAborted(signal);
      layer.store.putImageData(filled, 0, 0);
      doc.invalidateActive();
      history.commitOperation(doc, "API 塗りつぶし", [layer.meta.id]);
      recordDrawingActivity(doc.width * doc.height);
      await timelapse.captureIfEnabled(doc);
      return { changed: true, layerId: layer.meta.id };
    } catch (error) {
      history.cancelOperation();
      throw error;
    }
  });
}

function registerGradientTool(api: PaintApi): void {
  api.register({
    name: "drawing.gradient",
    description: "既存の Worker グラデーション処理を適用します。",
    parameters: objectSchema({
      kind: enumSchema(["linear", "radial"]),
      from: objectSchema({ x: { type: "number" }, y: { type: "number" }, color: colorSchema, alpha: { type: "number", minimum: 0, maximum: 1 } }, ["x", "y", "color", "alpha"]),
      to: objectSchema({ x: { type: "number" }, y: { type: "number" }, color: colorSchema, alpha: { type: "number", minimum: 0, maximum: 1 } }, ["x", "y", "color", "alpha"]),
      preset: enumSchema(["two-color", "rainbow"]),
    }, ["kind", "from", "to"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    requireActiveDrawable(doc); throwIfAborted(signal);
    const from = args.from as GradientPoint; const to = args.to as GradientPoint;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) {
      throw new PaintApiFault("INVALID_ARGUMENT", "グラデーションの始点と終点が近すぎます");
    }
    await applyGradient(doc, history, timelapse, args.kind as "linear" | "radial", from, to, selection, (args.preset as "two-color" | "rainbow" | undefined) ?? "two-color");
    return { changed: true, layerId: doc.activeLayerId };
  });
}

function registerBlurTool(api: PaintApi): void {
  api.register({
    name: "drawing.blur",
    description: "アクティブレイヤーの選択範囲を Worker でぼかします。",
    parameters: objectSchema({ radius: { type: "integer", minimum: 1, maximum: 200 } }, ["radius"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    requireActiveDrawable(doc); throwIfAborted(signal);
    await applyBlur(doc, history, timelapse, args.radius as number, selection);
    return { changed: true, layerId: doc.activeLayerId };
  });
}

function registerColorAdjustmentTool(api: PaintApi): void {
  api.register({
    name: "drawing.color_adjust",
    description: "選択範囲へ明るさ・コントラスト、HSL、反転、グレースケール、セピア、カーブ、レベルを適用します。",
    parameters: objectSchema({ adjustment: { anyOf: [
      objectSchema({ kind: { type: "string", enum: ["brightnessContrast"] }, brightness: { type: "number", minimum: -100, maximum: 100 }, contrast: { type: "number", minimum: -100, maximum: 100 } }, ["kind", "brightness", "contrast"]),
      objectSchema({ kind: { type: "string", enum: ["hsl"] }, hueShift: { type: "number", minimum: -180, maximum: 180 }, satScale: { type: "number", minimum: -100, maximum: 100 }, lightAdd: { type: "number", minimum: -100, maximum: 100 } }, ["kind", "hueShift", "satScale", "lightAdd"]),
      objectSchema({ kind: { type: "string", enum: ["invert", "grayscale", "sepia"] } }, ["kind"]),
      objectSchema({ kind: { type: "string", enum: ["curves"] }, red: lutPointsSchema(), green: lutPointsSchema(), blue: lutPointsSchema() }, ["kind", "red", "green", "blue"]),
      objectSchema({ kind: { type: "string", enum: ["levels"] }, inBlack: { type: "number", minimum: 0, maximum: 254 }, gamma: { type: "number", minimum: 0.01, maximum: 9.99 }, inWhite: { type: "number", minimum: 1, maximum: 255 }, outBlack: { type: "number", minimum: 0, maximum: 255 }, outWhite: { type: "number", minimum: 0, maximum: 255 } }, ["kind", "inBlack", "gamma", "inWhite", "outBlack", "outWhite"]),
    ] } }, ["adjustment"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    const layer = requireActiveDrawable(doc);
    const bbox = selectionBBox(selection, doc.width, doc.height);
    history.beginOperation(doc, [layer.meta.id], { trackRegion: true, initialRegion: bbox });
    try {
      const before = layer.store.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
      const after = applyAdjustment(before, parseAdjustment(args.adjustment as Record<string, unknown>));
      const mask = buildSelectionMaskAlpha(selection, bbox, doc.width, doc.height);
      blendWithMask(before, after, mask);
      if (layer.meta.transparentPixelLock) applyTransparentPixelLock(before, after);
      throwIfAborted(signal);
      layer.store.putImageData(after, bbox.x, bbox.y);
      doc.invalidateActive(); history.commitOperation(doc, "API 色調補正", [layer.meta.id]);
      await timelapse.captureIfEnabled(doc);
      return { changed: true, layerId: layer.meta.id, bounds: bbox };
    } catch (error) { history.cancelOperation(); throw error; }
  });
}

async function applyRasterMutation(
  input: { doc: import("../PaintDocument").PaintDocument; history: import("../History").History; timelapse: import("../Timelapse").Timelapse; selection: Selection; layer: import("../PaintDocument").PixelLayer; bbox: Rect; label: string; signal?: AbortSignal },
  draw: (ctx: CanvasRenderingContext2D) => void
): Promise<void> {
  const { doc, history, timelapse, selection, layer, bbox, label, signal } = input;
  history.beginOperation(doc, [layer.meta.id], { trackRegion: true, initialRegion: bbox });
  try {
    const before = layer.store.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    const canvas = document.createElement("canvas"); canvas.width = bbox.w; canvas.height = bbox.h;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
    ctx.putImageData(before, 0, 0); ctx.save(); ctx.translate(-bbox.x, -bbox.y); draw(ctx); ctx.restore();
    const after = ctx.getImageData(0, 0, bbox.w, bbox.h);
    const mask = buildSelectionMaskAlpha(selection, bbox, doc.width, doc.height);
    blendWithMask(before, after, mask);
    if (layer.meta.transparentPixelLock) applyTransparentPixelLock(before, after);
    throwIfAborted(signal);
    layer.store.putImageData(after, bbox.x, bbox.y);
    doc.invalidateActive(); history.commitOperation(doc, label, [layer.meta.id]);
    recordDrawingActivity(bbox.w * bbox.h); await timelapse.captureIfEnabled(doc);
  } catch (error) { history.cancelOperation(); throw error; }
}

function strokeBounds(points: StrokePoint[], settings: BrushSettings, width: number, height: number): Rect | null {
  let result: Rect | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const rect = brushStrokeBounds(points[Math.max(0, i - 1)], points[i], settings);
    result = result ? unionRect(result, rect) : rect;
  }
  return result ? clampRect(result, width, height) : null;
}

type PathCommand =
  | { op: "move" | "line"; x: number; y: number }
  | { op: "quadratic"; cpx: number; cpy: number; x: number; y: number }
  | { op: "bezier"; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { op: "close" };
type GradientPoint = { x: number; y: number; color: string; alpha: number };

function applyPathCommand(ctx: CanvasRenderingContext2D, command: PathCommand): void {
  if (command.op === "move") ctx.moveTo(command.x, command.y);
  else if (command.op === "line") ctx.lineTo(command.x, command.y);
  else if (command.op === "quadratic") ctx.quadraticCurveTo(command.cpx, command.cpy, command.x, command.y);
  else if (command.op === "bezier") ctx.bezierCurveTo(command.cp1x, command.cp1y, command.cp2x, command.cp2y, command.x, command.y);
  else ctx.closePath();
}

function pathBounds(commands: PathCommand[], strokeWidth: number, width: number, height: number): Rect | null {
  const xs: number[] = []; const ys: number[] = [];
  for (const command of commands) {
    if (command.op === "close") continue;
    xs.push(command.x); ys.push(command.y);
    if (command.op === "quadratic") { xs.push(command.cpx); ys.push(command.cpy); }
    if (command.op === "bezier") { xs.push(command.cp1x, command.cp2x); ys.push(command.cp1y, command.cp2y); }
  }
  if (xs.length === 0) return null;
  const pad = Math.max(2, strokeWidth / 2 + 2);
  return clampRect({ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 }, width, height);
}

function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.floor(rect.x)); const y = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w)); const y2 = Math.min(height, Math.ceil(rect.y + rect.h));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}
function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w); const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}
function lutPointsSchema(): import("./types").JsonSchema {
  return { type: "array", minItems: 1, maxItems: 64, items: objectSchema({ x: { type: "number", minimum: 0, maximum: 255 }, y: { type: "number", minimum: 0, maximum: 255 } }, ["x", "y"]) };
}
function parseAdjustment(value: Record<string, unknown>): ColorAdjustment {
  if (value.kind === "curves") {
    return { kind: "curves", lutR: buildCurveLUT(value.red as Array<{x:number;y:number}>), lutG: buildCurveLUT(value.green as Array<{x:number;y:number}>), lutB: buildCurveLUT(value.blue as Array<{x:number;y:number}>) };
  }
  if (value.kind === "levels") {
    const lut = buildLevelsLUT(value.inBlack as number, value.gamma as number, value.inWhite as number, value.outBlack as number, value.outWhite as number);
    return { kind: "levels", lutR: lut, lutG: new Uint8ClampedArray(lut), lutB: new Uint8ClampedArray(lut) };
  }
  return value as ColorAdjustment;
}

function isPointSelected(x: number, y: number, selection: Selection, docWidth: number, docHeight: number): boolean {
  if (selection.kind === "none") return true;
  if (selection.kind === "rect") return x >= selection.x && y >= selection.y && x < selection.x + selection.w && y < selection.y + selection.h;
  if (selection.kind === "polygon") {
    let inside = false;
    for (let i = 0, j = selection.points.length - 1; i < selection.points.length; j = i, i += 1) {
      const a = selection.points[i]; const b = selection.points[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x) inside = !inside;
    }
    return inside;
  }
  const offsetX = selection.maskWidth === docWidth ? 0 : selection.x;
  const offsetY = selection.maskHeight === docHeight ? 0 : selection.y;
  const mx = Math.floor(x - offsetX); const my = Math.floor(y - offsetY);
  if (mx < 0 || my < 0 || mx >= selection.maskWidth || my >= selection.maskHeight) return false;
  return selection.data[(my * selection.maskWidth + mx) * 4 + 3] >= 128;
}
