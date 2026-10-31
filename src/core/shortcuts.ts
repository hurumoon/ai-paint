import { ShortcutMap } from "../types";

// すべてのアクション ID。表示順は SHORTCUT_ACTIONS の順。
export const SHORTCUT_ACTIONS: { id: string; label: string; default: string }[] = [
  { id: "tool.brush", label: "ブラシ", default: "b" },
  { id: "tool.eraser", label: "消しゴム", default: "e" },
  { id: "tool.bucket", label: "バケツ", default: "g" },
  { id: "tool.eyedropper", label: "スポイト", default: "i" },
  { id: "tool.select", label: "範囲指定", default: "m" },
  { id: "tool.shape", label: "図形", default: "u" },
  { id: "tool.move", label: "移動", default: "v" },
  { id: "tool.layerPick", label: "レイヤー選択", default: "" },
  { id: "tool.text", label: "テキスト", default: "t" },
  { id: "tool.gradient", label: "グラデーション", default: "shift+g" },
  { id: "tool.blur", label: "ぼかし", default: "shift+b" },
  { id: "file.new", label: "新規キャンバス", default: "ctrl+n" },
  { id: "file.save", label: "上書き保存", default: "ctrl+s" },
  { id: "file.saveAs", label: "名前を付けて保存", default: "ctrl+shift+s" },
  { id: "file.open", label: "ファイルを開く", default: "ctrl+o" },
  { id: "edit.undo", label: "アンドゥ", default: "ctrl+z" },
  { id: "edit.redo", label: "リドゥ", default: "ctrl+shift+z" },
  { id: "edit.redo2", label: "リドゥ（別）", default: "ctrl+y" },
  { id: "edit.colorAdjust", label: "色調補正", default: "ctrl+u" },
  { id: "edit.selectAll", label: "全選択", default: "ctrl+a" },
  { id: "layer.new", label: "新規レイヤー", default: "ctrl+shift+n" },
  { id: "tab.close", label: "タブを閉じる", default: "ctrl+w" },
  { id: "brush.sizeDown", label: "ブラシを小さく", default: "[" },
  { id: "brush.sizeUp", label: "ブラシを大きく", default: "]" },
  { id: "brush.stabilizerDown", label: "手振れ補正を小さく", default: "alt+[" },
  { id: "brush.stabilizerUp", label: "手振れ補正を大きく", default: "alt+]" },
  { id: "color.swap", label: "前景/背景色入れ替え", default: "x" },
  { id: "selection.clear", label: "選択解除", default: "escape" },
  { id: "view.grid", label: "グリッド表示切替", default: "shift+'" },
  { id: "view.reset", label: "ズーム/パン リセット", default: "0" },
  { id: "view.zoomIn", label: "ズームイン", default: "ctrl+=" },
  { id: "view.zoomOut", label: "ズームアウト", default: "ctrl+-" },
  { id: "view.rotateCW", label: "右回転 (90°)", default: "shift+]" },
  { id: "view.rotateCCW", label: "左回転 (90°)", default: "shift+[" },
  { id: "view.flipHorizontal", label: "左右反転表示", default: "shift+h" },
  { id: "view.pan", label: "パン (キャンバスドラッグ移動)", default: "mousebutton2" },
  // 巨大ドキュメント (16384px 級) で中間合成 canvas プールに数 GB 残留した時の
  // 緊急用。通常は呼ぶ必要なし。default は空 (未バインド) にしておき、
  // 必要な人だけショートカット設定から割り当てる。
  { id: "system.clearCanvasPool", label: "中間canvasプール解放", default: "" },
];

export const DEFAULT_SHORTCUTS: ShortcutMap = SHORTCUT_ACTIONS.reduce<ShortcutMap>(
  (acc, a) => {
    acc[a.id] = a.default;
    return acc;
  },
  {}
);

const STORAGE_KEY = "ai-paint-shortcuts";

export function loadShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const saved = JSON.parse(raw) as ShortcutMap;
    // 不足キーはdefaultで補う
    return { ...DEFAULT_SHORTCUTS, ...saved };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}
export function saveShortcuts(map: ShortcutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // noop
  }
}

// KeyboardEvent → 標準化されたキー文字列
export function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  let k = e.key.toLowerCase();
  if (k === " ") k = "space";
  // 修飾キー自体は除外（押下中の値は使わない）
  if (k === "control" || k === "meta" || k === "shift" || k === "alt") {
    return parts.join("+");
  }
  parts.push(k);
  return parts.join("+");
}

// PointerEvent / MouseEvent → 標準化されたマウスボタン文字列
// 例: "mousebutton2" (右クリック), "shift+mousebutton1" (Shift+中クリック)
export function pointerEventToKeyString(
  e: PointerEvent | MouseEvent | { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }
): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(`mousebutton${e.button}`);
  return parts.join("+");
}

// マウスボタン番号 → 表示名
const MOUSE_BUTTON_LABELS: Record<number, string> = {
  0: "左クリック",
  1: "中クリック",
  2: "右クリック",
  3: "戻るボタン",
  4: "進むボタン",
};

// combo 文字列 → 表示用の整形 (mousebutton2 → 右クリック など)
export function formatComboForDisplay(combo: string): string {
  if (!combo) return "";
  const parts = combo.toLowerCase().split("+");
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^mousebutton(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      out.push(MOUSE_BUTTON_LABELS[n] ?? `マウス${n}`);
    } else {
      out.push(p);
    }
  }
  return out.join("+");
}

// アクションid → ハンドラ関数の辞書を受け取って dispatch する
export function dispatchShortcut(
  e: KeyboardEvent,
  map: ShortcutMap,
  handlers: Record<string, () => void>
): boolean {
  const key = eventToKeyString(e);
  for (const [actionId, combo] of Object.entries(map)) {
    if (!combo) continue;
    if (combo.toLowerCase() === key && handlers[actionId]) {
      handlers[actionId]();
      return true;
    }
  }
  return false;
}

// 指定 actionId の combo がこの pointer イベントと一致するか
export function matchPointerShortcut(
  e: PointerEvent | MouseEvent | { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  map: ShortcutMap,
  actionId: string
): boolean {
  const combo = map[actionId];
  if (!combo) return false;
  return combo.toLowerCase() === pointerEventToKeyString(e);
}
