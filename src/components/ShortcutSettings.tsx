import { useEffect, useState } from "react";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  eventToKeyString,
  formatComboForDisplay,
  pointerEventToKeyString,
  saveShortcuts,
} from "../core/shortcuts";
import { ShortcutMap } from "../types";
import { Button, pushToast } from "../ui/primitives";

interface Props {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutMap;
  setShortcuts: (m: ShortcutMap) => void;
}

export function ShortcutSettings({ open, onClose, shortcuts, setShortcuts }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [local, setLocal] = useState<ShortcutMap>(shortcuts);

  useEffect(() => {
    setLocal(shortcuts);
  }, [shortcuts, open]);

  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setEditingId(null);
        return;
      }
      // 修飾だけの入力は無視
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const combo = eventToKeyString(e);
      setLocal((prev) => ({ ...prev, [editingId]: combo }));
      setEditingId(null);
    };
    // マウスボタン入力も受け付ける。
    // contextmenu は右クリック直後にダイアログを閉じてしまうため抑止する。
    const onMouseDown = (e: MouseEvent) => {
      // クリア用 × ボタンや行内ボタンなど、ダイアログ内のクリックは無視
      // （編集中状態を解除しないでそのまま続けたいケースも考慮）
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button")) {
        // ボタン操作は通す（外側で処理させる）
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const combo = pointerEventToKeyString(e);
      setLocal((prev) => ({ ...prev, [editingId]: combo }));
      setEditingId(null);
    };
    const onContextMenu = (e: MouseEvent) => {
      // 編集中の右クリックはメニュー抑止（mousedown 側で受ける）
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [editingId]);

  if (!open) return null;

  // combo → そのキーが割り当てられているアクションラベル一覧
  const comboToLabels = new Map<string, string[]>();
  for (const a of SHORTCUT_ACTIONS) {
    const c = (local[a.id] || "").toLowerCase();
    if (!c) continue;
    const list = comboToLabels.get(c) || [];
    list.push(a.label);
    comboToLabels.set(c, list);
  }
  const duplicates = new Set<string>();
  for (const [c, labels] of comboToLabels) {
    if (labels.length >= 2) duplicates.add(c);
  }

  const apply = () => {
    if (duplicates.size > 0) {
      const lines = Array.from(duplicates).map((c) => {
        const labels = comboToLabels.get(c) || [];
        return `  ${c} → ${labels.join(", ")}`;
      });
      const ok = window.confirm(
        "以下のショートカットが重複しています。\n" +
          "このまま保存すると、上に書かれているアクションだけが反応します。\n\n" +
          lines.join("\n") +
          "\n\nそれでも保存しますか？"
      );
      if (!ok) return;
    }
    setShortcuts(local);
    saveShortcuts(local);
    pushToast("ショートカットを保存しました", "success");
    onClose();
  };
  const resetAll = () => {
    setLocal({ ...DEFAULT_SHORTCUTS });
  };

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="popover"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          minWidth: 420,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 4px 10px 4px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong style={{ fontSize: 13 }}>ショートカット設定</strong>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>
        <div
          style={{
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 4,
            padding: "8px 4px",
            alignItems: "center",
          }}
        >
          {SHORTCUT_ACTIONS.map((a) => {
            const combo = local[a.id] || "";
            const isDup = !!combo && duplicates.has(combo.toLowerCase());
            const conflicts = isDup
              ? (comboToLabels.get(combo.toLowerCase()) || []).filter(
                  (l) => l !== a.label
                )
              : [];
            return (
              <Row
                key={a.id}
                label={a.label}
                combo={combo}
                isEditing={editingId === a.id}
                isDuplicate={isDup}
                conflicts={conflicts}
                onStart={() => setEditingId(a.id)}
                onClear={() => setLocal((prev) => ({ ...prev, [a.id]: "" }))}
              />
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "space-between",
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
          }}
        >
          <Button onClick={resetAll}>デフォルトに戻す</Button>
          <div style={{ display: "flex", gap: 6 }}>
            <Button onClick={onClose}>キャンセル</Button>
            <Button variant="primary" onClick={apply}>保存</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  combo,
  isEditing,
  isDuplicate,
  conflicts,
  onStart,
  onClear,
}: {
  label: string;
  combo: string;
  isEditing: boolean;
  isDuplicate: boolean;
  conflicts: string[];
  onStart: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: "var(--text)", padding: "4px 8px" }}>
        {label}
        {isDuplicate && conflicts.length > 0 && (
          <div
            style={{
              fontSize: 10,
              color: "#ff6b6b",
              marginTop: 2,
            }}
            title={`「${conflicts.join("」「")}」と重複しています`}
          >
            ⚠ {conflicts.join(", ")} と重複
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button
          className={`btn ${isEditing ? "primary" : ""}`}
          style={{
            minWidth: 130,
            fontFamily: "monospace",
            fontSize: 11,
            ...(isDuplicate
              ? { borderColor: "#ff6b6b", color: "#ff6b6b" }
              : {}),
          }}
          onClick={onStart}
        >
          {isEditing
            ? "キー/マウスを押してください…"
            : combo
              ? formatComboForDisplay(combo)
              : "（未割当）"}
        </button>
        <button className="btn ghost" title="クリア" onClick={onClear}>
          ×
        </button>
      </div>
    </>
  );
}
