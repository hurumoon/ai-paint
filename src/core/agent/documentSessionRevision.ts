import type { PaintDocument } from "../PaintDocument";

// 同じPaintDocumentへバックアップを戻す場合も、保持中のAgentを復元記録へ切り替える。
const revisions = new WeakMap<PaintDocument, number>();
export function getSessionLoadRevision(doc: PaintDocument | undefined): number {
  return doc ? revisions.get(doc) ?? 0 : 0;
}
export function markSessionLoaded(doc: PaintDocument): void {
  revisions.set(doc, getSessionLoadRevision(doc) + 1);
  doc.invalidate();
}
