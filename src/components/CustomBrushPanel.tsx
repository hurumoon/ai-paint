import { useEffect, useRef, useState } from "react";
import {
  addCustomBrush,
  CustomBrushDef,
  listCustomBrushes,
  removeCustomBrush,
  subscribeCustomBrushes,
  updateCustomBrush,
} from "../core/customBrush";
import { pushToast, Slider } from "../ui/primitives";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CustomBrushPanel({ selectedId, onSelect }: Props) {
  const [brushes, setBrushes] = useState<CustomBrushDef[]>(listCustomBrushes());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeCustomBrushes(() => setBrushes(listCustomBrushes()));
  }, []);

  const handleAdd = async (file: File) => {
    try {
      const def = await addCustomBrush(file);
      onSelect(def.id);
      pushToast(`カスタムブラシ「${def.name}」を追加`, "success");
    } catch (e) {
      pushToast(`追加失敗: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  const sel = brushes.find((b) => b.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          className="btn"
          style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={() => fileRef.current?.click()}
        >
          画像から追加
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleAdd(f);
            e.target.value = "";
          }}
        />
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
          {brushes.length}/32
        </span>
      </div>

      {brushes.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
          PNG など透過画像を追加するとスタンプ系ブラシとして使えます。
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 4,
          }}
        >
          {brushes.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              title={b.name}
              style={{
                border:
                  selectedId === b.id
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                background: "var(--bg-elev)",
                padding: 2,
                borderRadius: 4,
                cursor: "pointer",
                aspectRatio: "1",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <img
                src={b.dataUrl}
                alt={b.name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 6,
            background: "var(--bg-elev)",
            borderRadius: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <input
              className="input"
              value={sel.name}
              onChange={(e) => updateCustomBrush(sel.id, { name: e.target.value })}
              style={{ fontSize: 11, padding: "2px 6px", flex: 1 }}
            />
            <button
              className="btn ghost"
              style={{ fontSize: 10, padding: "2px 6px", color: "#f66" }}
              onClick={() => {
                if (confirm(`「${sel.name}」を削除しますか？`)) {
                  removeCustomBrush(sel.id);
                }
              }}
            >
              削除
            </button>
          </div>
          <Slider
            label="間隔"
            value={Math.round(sel.spacingRatio * 100)}
            min={1}
            max={100}
            onChange={(v) =>
              updateCustomBrush(sel.id, { spacingRatio: v / 100 })
            }
            format={(v) => `${v}%`}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            <input
              type="checkbox"
              checked={sel.tint}
              onChange={(e) => updateCustomBrush(sel.id, { tint: e.target.checked })}
            />
            前景色で色付け
          </label>
        </div>
      )}
    </div>
  );
}
