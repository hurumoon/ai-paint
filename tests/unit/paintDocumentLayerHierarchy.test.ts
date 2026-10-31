import { describe, expect, it } from "vitest";
import { PaintDocument } from "../../src/core/PaintDocument";

function layerIds(doc: PaintDocument): string[] {
  return doc.layers.map((layer) => layer.meta.id);
}

describe("PaintDocument layer hierarchy", () => {
  it("normalizes adopted layer objects into contiguous hierarchy blocks", () => {
    const doc = new PaintDocument(8, 8, 1);
    const top = doc.layers[0];
    const group = doc.addGroup("フォルダ");
    const childA = doc.addLayer("子A");
    const childB = doc.addLayer("子B");

    doc.replaceLayerObjects([childA, group, top, childB], childA.meta.id);

    expect(layerIds(doc)).toEqual([
      group.meta.id,
      childA.meta.id,
      childB.meta.id,
      top.meta.id,
    ]);
    expect(doc.activeLayerId).toBe(childA.meta.id);
  });

  it("rejects a beforeId outside the target parent", () => {
    const doc = new PaintDocument(8, 8, 1);
    const top = doc.layers[0];
    const group = doc.addGroup("フォルダ");
    const child = doc.addLayer("子");
    const before = layerIds(doc);
    const snapshot = doc.getSnapshot();

    doc.reorderLayer(top.meta.id, null, child.meta.id);

    expect(layerIds(doc)).toEqual(before);
    expect(top.meta.parentId).toBeUndefined();
    expect(child.meta.parentId).toBe(group.meta.id);
    expect(doc.getSnapshot()).toBe(snapshot);
  });

  it("keeps the remaining children contiguous when a layer leaves a group", () => {
    const doc = new PaintDocument(8, 8, 1);
    const base = doc.layers[0];
    const group = doc.addGroup("フォルダ");
    const childA = doc.addLayer("子A");
    const childB = doc.addLayer("子B");

    expect(layerIds(doc)).toEqual([
      base.meta.id,
      group.meta.id,
      childA.meta.id,
      childB.meta.id,
    ]);

    doc.setLayerParent(childA.meta.id, null);

    expect(layerIds(doc)).toEqual([
      base.meta.id,
      group.meta.id,
      childB.meta.id,
      childA.meta.id,
    ]);
    expect(childA.meta.parentId).toBeUndefined();
    expect(childB.meta.parentId).toBe(group.meta.id);

    doc.setActiveLayer(group.meta.id);
    const childC = doc.addLayer("子C");

    expect(layerIds(doc)).toEqual([
      base.meta.id,
      group.meta.id,
      childB.meta.id,
      childC.meta.id,
      childA.meta.id,
    ]);
    expect(childC.meta.parentId).toBe(group.meta.id);
  });
});
