import { useCallback, useEffect, useState } from "react";
import { safeGetStorageItem, safeSetStorageItem } from "../core/safeStorage";
import { Theme } from "../types";

const STORAGE_KEY = "ai-paint-theme";

function getInitialTheme(): Theme {
  const saved = safeGetStorageItem(STORAGE_KEY) as Theme | null;
  if (saved === "dark" || saved === "light") return saved;
  // OS が dark を希望していれば dark、それ以外（light or 未指定）は light
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    safeSetStorageItem(STORAGE_KEY, theme);
  }, [theme]);

  // 他ウィンドウ (チャットウィンドウ等) でテーマが変わった場合に追従する。
  // storage イベントは同一オリジン内の他ウィンドウからしか飛んでこないので、
  // 自分自身の setItem ではループしない。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue;
      if (next === "dark" || next === "light") setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return { theme, setTheme, toggleTheme };
}
