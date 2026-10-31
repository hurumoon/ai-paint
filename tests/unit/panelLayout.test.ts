import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIDDEN_SECTIONS,
  DEFAULT_LAYOUT,
  DEFAULT_RIGHT_SECTIONS,
  DEFAULT_TOP_BAR_HIDDEN_ITEMS,
  DEFAULT_TOP_BAR_LEFT_ITEMS,
  DEFAULT_TOP_BAR_RIGHT_ITEMS,
  normalizeLayout,
} from "../../src/core/panelLayout";

describe("normalizeLayout", () => {
  it("keeps the requested panels and top bar items hidden by default", () => {
    expect(DEFAULT_LAYOUT.rightSections).toEqual(DEFAULT_RIGHT_SECTIONS);
    expect(DEFAULT_LAYOUT.hidden).toEqual(DEFAULT_HIDDEN_SECTIONS);
    expect(DEFAULT_LAYOUT.topBarRightItems).toEqual(DEFAULT_TOP_BAR_RIGHT_ITEMS);
    expect(DEFAULT_LAYOUT.topBarHiddenItems).toEqual(DEFAULT_TOP_BAR_HIDDEN_ITEMS);
  });

  it("fills top bar placement for old saved layouts", () => {
    const layout = normalizeLayout({
      flipped: true,
      leftSections: ["layers"],
      rightSections: ["view"],
      hidden: ["chat"],
    });

    expect(layout.flipped).toBe(true);
    expect(layout.topBarLeftItems).toEqual(DEFAULT_TOP_BAR_LEFT_ITEMS);
    expect(layout.topBarRightItems).toEqual(DEFAULT_TOP_BAR_RIGHT_ITEMS);
    expect(layout.topBarHiddenItems).toEqual(DEFAULT_TOP_BAR_HIDDEN_ITEMS);
  });

  it("adds AI Draw to old layouts without moving their saved sections", () => {
    const layout = normalizeLayout({
      flipped: true,
      leftSections: ["layers"],
      rightSections: ["view"],
      hidden: ["chat"],
    });

    expect(layout.leftSections).toEqual(["layers"]);
    expect(layout.rightSections).toEqual(["view", "text", "grid", "aiDraw"]);
    expect(layout.hidden).toEqual(["chat", "activity", "timelapse", "ai"]);
  });

  it("preserves an explicit AI Draw placement", () => {
    const layout = normalizeLayout({
      leftSections: ["aiDraw", "layers"],
      rightSections: ["chat"],
      hidden: ["ai"],
    });

    expect(layout.leftSections).toEqual(["aiDraw", "layers"]);
    expect(layout.rightSections).not.toContain("aiDraw");
    expect(layout.hidden).not.toContain("aiDraw");
  });

  it("does not allow layout settings to be restored as a hidden top bar item", () => {
    const layout = normalizeLayout({
      topBarLeftItems: ["about"],
      topBarRightItems: ["theme"],
      topBarHiddenItems: ["layoutSettings", "save"],
    });

    expect(layout.topBarHiddenItems).toEqual([
      "save",
      ...DEFAULT_TOP_BAR_HIDDEN_ITEMS,
    ]);
    expect(layout.topBarRightItems).toContain("layoutSettings");
  });
});
