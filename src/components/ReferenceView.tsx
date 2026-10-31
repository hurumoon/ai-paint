import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../ui/primitives";
import { getReferenceViewState, setReferenceViewImage, subscribeReferenceView, updateReferenceView } from "../core/referenceViewState";

interface Props {
  onClose: () => void;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// お手本画像を表示しておくサブビュー。
// D&D / クリップボード貼り付けで画像を差し替えできる。
// ホイールでズーム、ドラッグでパン、ダブルクリックで原寸ポップアップ。
export function ReferenceView({ onClose }: Props) {
  const { src, zoom, offset, popup } = useSyncExternalStore(subscribeReferenceView, getReferenceViewState);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // 画像を差し替えたらズーム/パンをリセット
  const setImage = setReferenceViewImage;

  // クリップボードからの貼り付け。サブビュー自身がフォーカスを持っているか、
  // または document.activeElement がテキスト入力でない場合に画像を拾う。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = async (e: ClipboardEvent) => {
      if (el.closest("[inert]")) return;
      const ae = document.activeElement;
      const isInsideRef = ae === el || (ae && el.contains(ae));
      const isTextInput =
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae instanceof HTMLElement && ae.isContentEditable);
      if (!isInsideRef && isTextInput) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const url = await fileToDataUrl(file);
            setImage(url);
            return;
          }
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [setImage]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const url = await fileToDataUrl(file);
      setImage(url);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!src) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    updateReferenceView({ zoom: Math.max(0.2, Math.min(8, zoom * factor)) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!src || zoom <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    updateReferenceView({ offset: { x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) } });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (draggingRef.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      draggingRef.current = null;
    }
  };

  return (
    <div
      className="reference-view"
      ref={containerRef}
      tabIndex={0}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="subview-title">
        <span>リファレンス</span>
        <span style={{ display: "flex", gap: 2 }}>
          {src && (
            <IconButton
              onClick={() => setImage(null)}
              title="画像をクリア"
              style={{ width: 18, height: 18, fontSize: 11 }}
            >
              ⌫
            </IconButton>
          )}
          <IconButton
            onClick={onClose}
            title="閉じる"
            style={{ width: 18, height: 18 }}
          >
            ×
          </IconButton>
        </span>
      </div>
      <div
        className={`reference-view-body${dragOver ? " is-drag-over" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => src && updateReferenceView({ popup: true })}
      >
        {src ? (
          <img
            src={src}
            alt="reference"
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? "grab" : "default",
            }}
          />
        ) : (
          <div className="reference-view-empty">
            画像をドロップ
            <br />
            または Ctrl+V
          </div>
        )}
      </div>
      {popup && src && (
        <div className="reference-popup" onClick={() => updateReferenceView({ popup: false })}>
          <img src={src} alt="reference original" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
