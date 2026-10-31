export type RightSectionId =
  | "text"
  | "view"
  | "grid"
  | "activity"
  | "layers"
  | "timelapse"
  | "ai"
  | "aiDraw"
  | "chat";

export type TopBarItemId =
  | "about"
  | "canvasSettings"
  | "canvasExtend"
  | "newCanvas"
  | "openImage"
  | "openDirectImage"
  | "undo"
  | "redo"
  | "rotateCounterClockwise"
  | "rotateClockwise"
  | "horizontalFlip"
  | "subview"
  | "reference"
  | "drawingGuide"
  | "colorAdjust"
  | "layoutSettings"
  | "shortcutSettings"
  | "save"
  | "export"
  | "backup"
  | "theme";

export interface LayoutConfig {
  flipped: boolean;
  leftSections: RightSectionId[];
  rightSections: RightSectionId[];
  hidden: RightSectionId[];
  topBarLeftItems: TopBarItemId[];
  topBarRightItems: TopBarItemId[];
  topBarHiddenItems: TopBarItemId[];
}

export const ALL_SECTIONS: RightSectionId[] = [
  "text",
  "view",
  "grid",
  "activity",
  "layers",
  "timelapse",
  "ai",
  "chat",
  "aiDraw",
];

export const REQUIRED_TOP_BAR_ITEM_ID: TopBarItemId = "layoutSettings";

export const DEFAULT_TOP_BAR_LEFT_ITEMS: TopBarItemId[] = [
  "about",
  "canvasSettings",
  "canvasExtend",
  "newCanvas",
  "openImage",
  "openDirectImage",
  "undo",
  "redo",
];

export const DEFAULT_TOP_BAR_RIGHT_ITEMS: TopBarItemId[] = [
  "rotateCounterClockwise",
  "rotateClockwise",
  "horizontalFlip",
  "subview",
  "drawingGuide",
  "colorAdjust",
  "layoutSettings",
  "save",
  "export",
  "backup",
  "theme",
];

export const DEFAULT_TOP_BAR_HIDDEN_ITEMS: TopBarItemId[] = [
  "reference",
  "shortcutSettings",
];

export const ALL_TOP_BAR_ITEMS: TopBarItemId[] = [
  ...DEFAULT_TOP_BAR_LEFT_ITEMS,
  ...DEFAULT_TOP_BAR_RIGHT_ITEMS,
  ...DEFAULT_TOP_BAR_HIDDEN_ITEMS,
];

export const DEFAULT_RIGHT_SECTIONS: RightSectionId[] = [
  "text",
  "view",
  "grid",
  "layers",
  "chat",
  "aiDraw",
];

export const DEFAULT_HIDDEN_SECTIONS: RightSectionId[] = [
  "activity",
  "timelapse",
  "ai",
];

export const DEFAULT_LAYOUT: LayoutConfig = {
  flipped: false,
  leftSections: [],
  rightSections: [...DEFAULT_RIGHT_SECTIONS],
  hidden: [...DEFAULT_HIDDEN_SECTIONS],
  topBarLeftItems: [...DEFAULT_TOP_BAR_LEFT_ITEMS],
  topBarRightItems: [...DEFAULT_TOP_BAR_RIGHT_ITEMS],
  topBarHiddenItems: [...DEFAULT_TOP_BAR_HIDDEN_ITEMS],
};

export function normalizeLayout(raw: unknown): LayoutConfig {
  const out: LayoutConfig = {
    flipped: false,
    leftSections: [],
    rightSections: [],
    hidden: [],
    topBarLeftItems: [],
    topBarRightItems: [],
    topBarHiddenItems: [],
  };
  if (!raw || typeof raw !== "object") {
    return DEFAULT_LAYOUT;
  }
  const r = raw as Partial<LayoutConfig> & { sections?: RightSectionId[] };
  if (typeof r.flipped === "boolean") out.flipped = r.flipped;

  const seen = new Set<RightSectionId>();
  const collect = (arr: unknown): RightSectionId[] => {
    const cleaned: RightSectionId[] = [];
    if (!Array.isArray(arr)) return cleaned;
    for (const s of arr) {
      if (
        ALL_SECTIONS.includes(s as RightSectionId) &&
        !seen.has(s as RightSectionId)
      ) {
        cleaned.push(s as RightSectionId);
        seen.add(s as RightSectionId);
      }
    }
    return cleaned;
  };

  if (
    Array.isArray(r.leftSections) ||
    Array.isArray(r.rightSections) ||
    Array.isArray(r.hidden)
  ) {
    out.leftSections = collect(r.leftSections);
    out.rightSections = collect(r.rightSections);
    out.hidden = collect(r.hidden);
  } else if (Array.isArray(r.sections)) {
    out.rightSections = collect(r.sections);
  }

  for (const s of DEFAULT_RIGHT_SECTIONS) {
    if (!seen.has(s)) {
      out.rightSections.push(s);
      seen.add(s);
    }
  }
  for (const s of DEFAULT_HIDDEN_SECTIONS) {
    if (!seen.has(s)) {
      out.hidden.push(s);
      seen.add(s);
    }
  }

  const seenTopBar = new Set<TopBarItemId>();
  const collectTopBar = (arr: unknown, hidden: boolean): TopBarItemId[] => {
    const cleaned: TopBarItemId[] = [];
    if (!Array.isArray(arr)) return cleaned;
    for (const item of arr) {
      const id = item as TopBarItemId;
      if (
        ALL_TOP_BAR_ITEMS.includes(id) &&
        !seenTopBar.has(id) &&
        !(hidden && id === REQUIRED_TOP_BAR_ITEM_ID)
      ) {
        cleaned.push(id);
        seenTopBar.add(id);
      }
    }
    return cleaned;
  };

  if (
    Array.isArray(r.topBarLeftItems) ||
    Array.isArray(r.topBarRightItems) ||
    Array.isArray(r.topBarHiddenItems)
  ) {
    out.topBarLeftItems = collectTopBar(r.topBarLeftItems, false);
    out.topBarRightItems = collectTopBar(r.topBarRightItems, false);
    out.topBarHiddenItems = collectTopBar(r.topBarHiddenItems, true);
  }

  for (const item of DEFAULT_TOP_BAR_LEFT_ITEMS) {
    if (!seenTopBar.has(item)) {
      out.topBarLeftItems.push(item);
      seenTopBar.add(item);
    }
  }
  for (const item of DEFAULT_TOP_BAR_RIGHT_ITEMS) {
    if (!seenTopBar.has(item)) {
      out.topBarRightItems.push(item);
      seenTopBar.add(item);
    }
  }
  for (const item of DEFAULT_TOP_BAR_HIDDEN_ITEMS) {
    if (!seenTopBar.has(item)) {
      out.topBarHiddenItems.push(item);
      seenTopBar.add(item);
    }
  }

  return out;
}
