import { describe, expect, it } from "vitest";
import type { LayerKind } from "../../src/types";
import {
  getDescendantIds,
  insertionIndexAboveActive,
  isDescendantOf,
  normalizeLayerOrder,
  type LayerTreeNode,
} from "../../src/core/layerTree";

function node(id: string, kind: LayerKind = "raster", parentId?: string): LayerTreeNode {
  return {
    meta: {
      id,
      kind,
      parentId,
    },
  };
}

describe("layerTree", () => {
  it("normalizes parents and their descendants into stable contiguous blocks", () => {
    const layers = [
      node("child-a", "raster", "group"),
      node("grandchild", "raster", "nested"),
      node("group", "group"),
      node("top"),
      node("child-b", "raster", "group"),
      node("nested", "group", "group"),
    ];

    expect(normalizeLayerOrder(layers).map((layer) => layer.meta.id)).toEqual([
      "group",
      "child-a",
      "child-b",
      "nested",
      "grandchild",
      "top",
    ]);
  });

  it("collects nested descendants without including the root", () => {
    const layers = [
      node("root", "group"),
      node("child-a", "raster", "root"),
      node("child-group", "group", "root"),
      node("grandchild", "raster", "child-group"),
      node("sibling"),
    ];

    expect(getDescendantIds(layers, "root")).toEqual([
      "child-a",
      "child-group",
      "grandchild",
    ]);
  });

  it("stops descendant traversal on parent cycles", () => {
    const layers = [
      node("root", "group", "loop"),
      node("loop", "group", "root"),
      node("leaf", "raster", "loop"),
    ];

    expect(getDescendantIds(layers, "root")).toEqual(["loop", "leaf"]);
  });

  it("checks ancestor chains defensively", () => {
    const layers = [
      node("root", "group"),
      node("group", "group", "root"),
      node("leaf", "raster", "group"),
    ];

    expect(isDescendantOf(layers, "leaf", "root")).toBe(true);
    expect(isDescendantOf(layers, "root", "leaf")).toBe(false);
    expect(isDescendantOf(layers, "leaf", undefined)).toBe(false);
  });

  it("inserts above an active group after its contiguous descendants", () => {
    const layers = [
      node("base"),
      node("group", "group"),
      node("child-a", "raster", "group"),
      node("child-b", "raster", "group"),
      node("top"),
    ];

    expect(insertionIndexAboveActive(layers, "group")).toBe(4);
    expect(insertionIndexAboveActive(layers, "child-a")).toBe(3);
    expect(insertionIndexAboveActive(layers, "missing")).toBe(layers.length);
  });
});
