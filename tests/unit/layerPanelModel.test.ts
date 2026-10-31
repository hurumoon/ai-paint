import { describe, expect, it } from "vitest";
import { History } from "../../src/core/History";
import { PaintDocument, PixelLayer } from "../../src/core/PaintDocument";
import {
  canMergeDown,
  canRemoveLayer,
  withStructureHistory,
} from "../../src/components/layers/LayerPanelModel";

interface MergeSetup {
  doc: PaintDocument;
  lower: PixelLayer;
  upper: PixelLayer;
}

function createMergeSetup(): MergeSetup {
  const doc = new PaintDocument(4, 4, 1);
  const lower = doc.layers[0];
  const upper = doc.addLayer("upper");
  return { doc, lower, upper };
}

describe("LayerPanelModel", () => {
  it("rejects deleting the last drawable layer", () => {
    const doc = new PaintDocument(4, 4, 1);
    const active = doc.getActiveLayer();
    if (!active) throw new Error("active layer was not available");

    expect(canRemoveLayer(doc, active)).toBe(false);
    expect(doc.removeLayer(active.meta.id)).toBe(false);
    expect(doc.layers).toContain(active);
  });

  it("rejects merge down when the lower item is a group", () => {
    const doc = new PaintDocument(4, 4, 1);
    const group = doc.addGroup();
    const child = doc.addLayer("child");

    expect(doc.layers[doc.layers.indexOf(child) - 1]).toBe(group);
    expect(canMergeDown(doc, child)).toBe(false);
    expect(doc.mergeDown(child.meta.id)).toBe(false);
    expect(doc.layers).toContain(child);
  });

  it.each([
    [
      "upper is hidden",
      ({ upper }: MergeSetup) => {
        upper.meta.visible = false;
      },
    ],
    [
      "lower is hidden",
      ({ lower }: MergeSetup) => {
        lower.meta.visible = false;
      },
    ],
    [
      "lower has partial opacity",
      ({ lower }: MergeSetup) => {
        lower.meta.opacity = 0.5;
      },
    ],
    [
      "lower uses a non-normal blend mode",
      ({ lower }: MergeSetup) => {
        lower.meta.blendMode = "multiply";
      },
    ],
    [
      "upper is a clipping mask",
      ({ upper }: MergeSetup) => {
        upper.meta.clippingMask = true;
      },
    ],
    [
      "lower is a clipping mask",
      ({ lower }: MergeSetup) => {
        lower.meta.clippingMask = true;
      },
    ],
    [
      "upper is the base of a clipping mask",
      ({ doc, upper }: MergeSetup) => {
        doc.setActiveLayer(upper.meta.id);
        const clippingLayer = doc.addLayer("clipping");
        clippingLayer.meta.clippingMask = true;
      },
    ],
  ])("rejects merge down when %s", (_name, prepare) => {
    const setup = createMergeSetup();
    prepare(setup);

    expect(canMergeDown(setup.doc, setup.upper)).toBe(false);
    expect(setup.doc.mergeDown(setup.upper.meta.id)).toBe(false);
    expect(setup.doc.layers).toContain(setup.upper);
  });

  it("allows upper opacity and blend mode because they are baked into merged pixels", () => {
    const { doc, upper } = createMergeSetup();
    upper.meta.opacity = 0.5;
    upper.meta.blendMode = "multiply";

    expect(canMergeDown(doc, upper)).toBe(true);
  });

  it("cancels the pending structure operation when a guarded action reports no change", () => {
    const calls: string[] = [];
    const doc = {} as PaintDocument;
    const history = {
      beginStructureOperation: () => calls.push("begin"),
      commitStructureOperation: () => calls.push("commit"),
      cancelOperation: () => calls.push("cancel"),
    } as unknown as History;

    expect(withStructureHistory(doc, history, "レイヤー削除", () => false)).toBe(false);
    expect(calls).toEqual(["begin", "cancel"]);
  });
});
