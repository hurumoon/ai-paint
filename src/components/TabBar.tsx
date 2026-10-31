import { useRef, useState } from "react";
import type { Tab } from "../hooks/useTabs";

interface Props {
  tabs: Tab[];
  // タブが 0 個の場合は null。
  activeTabId: string | null;
  // 各タブが現在 dirty かを判定して boolean を返す。
  isDirty: (tab: Tab) => boolean;
  // 保存中 / ダイアログ表示中など、タブ選択も受け付けない期間。
  // true の間はクリック/閉じる/並べ替え/追加が全て無効化され、見た目もグレーアウトする。
  disabled?: boolean;
  // AI 解析中など、タブ選択は許可しつつタブ集合の変更だけ止める期間。
  actionsDisabled?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void | Promise<void>;
  onAddBlank: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function tabLabel(tab: Tab): string {
  return tab.fileName ?? `名称未設定${tab.untitledIndex}`;
}

export function TabBar({
  tabs,
  activeTabId,
  isDirty,
  disabled = false,
  onSelect,
  onClose,
  onAddBlank,
  onReorder,
  actionsDisabled = false,
}: Props) {
  const dragSrcRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const tabActionsDisabled = disabled || actionsDisabled;

  return (
    <div
      className={`tab-bar ${disabled ? "disabled" : ""}`}
      role="tablist"
      aria-disabled={disabled || undefined}
    >
      {tabs.map((tab, idx) => {
        const dirty = isDirty(tab);
        const isActive = tab.id === activeTabId;
        const isDragOver = dragOverIndex === idx;
        return (
          <div
            key={tab.id}
            className={`tab ${isActive ? "active" : ""} ${isDragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
            role="tab"
            aria-selected={isActive}
            aria-disabled={disabled || undefined}
            title={tab.filePath ?? tabLabel(tab)}
            draggable={!tabActionsDisabled}
            onDragStart={(e) => {
              if (tabActionsDisabled) {
                e.preventDefault();
                return;
              }
              dragSrcRef.current = idx;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-aipaint-tab", String(idx));
            }}
            onDragOver={(e) => {
              if (tabActionsDisabled) return;
              if (dragSrcRef.current == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverIndex(idx);
            }}
            onDragLeave={() => {
              setDragOverIndex((cur) => (cur === idx ? null : cur));
            }}
            onDrop={(e) => {
              if (tabActionsDisabled) return;
              e.preventDefault();
              const from = dragSrcRef.current;
              dragSrcRef.current = null;
              setDragOverIndex(null);
              if (from == null || from === idx) return;
              onReorder(from, idx);
            }}
            onDragEnd={() => {
              dragSrcRef.current = null;
              setDragOverIndex(null);
            }}
            onMouseDown={(e) => {
              if (tabActionsDisabled) return;
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            onClick={() => {
              if (disabled) return;
              onSelect(tab.id);
            }}
          >
            <span className="tab-label">
              {dirty ? "*" : ""}
              {tabLabel(tab)}
            </span>
            <button
              className="tab-close"
              title="タブを閉じる"
              disabled={tabActionsDisabled}
              onClick={(e) => {
                e.stopPropagation();
                if (tabActionsDisabled) return;
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="tab-add"
        title="新規タブ"
        disabled={tabActionsDisabled}
        onClick={() => {
          if (tabActionsDisabled) return;
          onAddBlank();
        }}
      >
        +
      </button>
    </div>
  );
}
