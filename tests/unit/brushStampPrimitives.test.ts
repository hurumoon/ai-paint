import { describe, expect, it } from "vitest";
import {
  lightenHex,
  transparentColor,
} from "../../src/core/brushStampPrimitives";

describe("brush stamp primitives", () => {
  it("converts supported colors to transparent rgba strings", () => {
    expect(transparentColor("#abc")).toBe("rgba(170, 187, 204, 0)");
    expect(transparentColor("#112233")).toBe("rgba(17, 34, 51, 0)");
    expect(transparentColor("rgb(1, 2, 3)")).toBe("rgba(1, 2, 3, 0)");
    expect(transparentColor("rgba(4, 5, 6, 0.7)")).toBe("rgba(4, 5, 6, 0)");
  });

  it("falls back to transparent black for unsupported color strings", () => {
    expect(transparentColor("currentColor")).toBe("rgba(0, 0, 0, 0)");
  });

  it("lightens hex colors without changing unsupported formats", () => {
    expect(lightenHex("#000000", 0.5)).toBe("rgb(128, 128, 128)");
    expect(lightenHex("#336699", 0.5)).toBe("rgb(153, 179, 204)");
    expect(lightenHex("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
  });
});
