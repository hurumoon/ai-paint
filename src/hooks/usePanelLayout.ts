import { useEffect, useState } from "react";
import {
  DEFAULT_LAYOUT,
  LayoutConfig,
  normalizeLayout,
} from "../core/panelLayout";

const LAYOUT_STORAGE = "ai-paint-layout";

export function usePanelLayout(): {
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
} {
  const [layout, setLayout] = useState<LayoutConfig>(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE);
      if (raw) return normalizeLayout(JSON.parse(raw));
    } catch {
      // 壊れた保存値は無視してデフォルト配置へ戻す。
    }
    return DEFAULT_LAYOUT;
  });

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE, JSON.stringify(layout));
    } catch {
      // localStorage が使えない環境ではパネル配置保存だけ諦める。
    }
  }, [layout]);

  return { layout, setLayout };
}
