import type { History } from "../History";
import type { PaintDocument, PixelLayer } from "../PaintDocument";
import type { Timelapse } from "../Timelapse";
import type { Selection } from "../../types";
import { PaintApiFault } from "./types";
import type { PaintApiContext } from "./types";

export interface BoundPaintState {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
}

export function requireState(context: PaintApiContext): BoundPaintState {
  const doc = context.getDocument();
  const history = context.getHistory();
  const timelapse = context.getTimelapse();
  if (!doc || !history || !timelapse) {
    throw new PaintApiFault("NO_DOCUMENT", "操作対象のドキュメントがありません");
  }
  return { doc, history, timelapse, selection: context.getSelection() };
}

export function requireActiveDrawable(doc: PaintDocument): PixelLayer {
  const layer = doc.getActiveLayer();
  if (!layer) throw new PaintApiFault("NO_DOCUMENT", "アクティブレイヤーがありません");
  if (layer.meta.locked) throw new PaintApiFault("LOCKED", "アクティブレイヤーはロックされています");
  if (layer.meta.kind === "group") {
    throw new PaintApiFault("LOCKED", "グループには描画できません");
  }
  return layer;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PaintApiFault("CANCELLED", "操作はキャンセルされました");
}

export async function withStructureHistory<T>(
  doc: PaintDocument,
  history: History,
  label: string,
  fn: () => T,
  options?: { pixelLayerIds?: string[] }
): Promise<T> {
  history.beginStructureOperation(doc, options);
  try {
    const value = fn();
    if (value === false) {
      history.cancelOperation();
      throw new PaintApiFault("INVALID_ARGUMENT", `${label}を実行できません`);
    }
    history.commitStructureOperation(doc, label);
    return value;
  } catch (error) {
    history.cancelOperation();
    throw error;
  }
}

export function readString(args: Record<string, unknown>, key: string): string {
  return args[key] as string;
}

export function readNumber(args: Record<string, unknown>, key: string): number {
  return args[key] as number;
}

export function readBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] as boolean;
}

export function selectionSummary(selection: Selection): Record<string, unknown> {
  if (selection.kind !== "mask") return selection;
  return {
    kind: selection.kind,
    x: selection.x,
    y: selection.y,
    w: selection.w,
    h: selection.h,
    maskWidth: selection.maskWidth,
    maskHeight: selection.maskHeight,
  };
}
