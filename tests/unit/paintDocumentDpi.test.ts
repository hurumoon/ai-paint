import { describe, expect, it } from "vitest";
import { PaintDocument } from "../../src/core/PaintDocument";
import { MAX_AIPAINT_DPI } from "../../src/core/nativeFormat";
import { DEFAULT_DPI } from "../../src/types";

describe("PaintDocument DPI", () => {
  it("clamps document DPI to the .aipaint-supported range", () => {
    const doc = new PaintDocument(10, 10, 1);

    doc.setDpi(MAX_AIPAINT_DPI + 1);
    expect(doc.dpi).toBe(MAX_AIPAINT_DPI);

    doc.setDpi(0);
    expect(doc.dpi).toBe(1);
  });

  it("keeps non-finite DPI values from entering document state", () => {
    const doc = new PaintDocument(10, 10, 1);

    doc.setDpi(Number.POSITIVE_INFINITY);
    expect(doc.dpi).toBe(DEFAULT_DPI);

    doc.setDpi(Number.NaN);
    expect(doc.dpi).toBe(DEFAULT_DPI);
  });

  it("uses the same DPI normalization when resetting for a new canvas", () => {
    const doc = new PaintDocument(10, 10, 1);

    doc.resetForNew(20, 20, MAX_AIPAINT_DPI + 100);
    expect(doc.dpi).toBe(MAX_AIPAINT_DPI);

    doc.resetForNew(20, 20, Number.NaN);
    expect(doc.dpi).toBe(DEFAULT_DPI);
  });
});
