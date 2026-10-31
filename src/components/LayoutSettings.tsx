import { Button } from "../ui/primitives";
import {
  DEFAULT_LAYOUT,
  LayoutConfig,
  REQUIRED_TOP_BAR_ITEM_ID,
  RightSectionId,
  TopBarItemId,
} from "../core/panelLayout";

export type PanelSide = "left" | "right" | "hidden";

const SECTION_LABEL: Record<RightSectionId, string> = {
  text: "テキスト編集",
  view: "表示（ズーム・回転）",
  grid: "グリッド",
  activity: "制作芝",
  layers: "レイヤー",
  timelapse: "タイムラプス",
  ai: "AI パネル",
  chat: "AI チャット",
  aiDraw: "AIドロー（β版）",
};

const SIDE_LABEL: Record<PanelSide, string> = {
  left: "左パネル",
  right: "右パネル",
  hidden: "非表示",
};

const TOP_BAR_SIDE_LABEL: Record<PanelSide, string> = {
  left: "左側",
  right: "右側",
  hidden: "非表示",
};

const TOP_BAR_LABEL: Record<TopBarItemId, string> = {
  about: "このアプリについて",
  canvasSettings: "設定",
  canvasExtend: "キャンバス拡張",
  newCanvas: "新規キャンバス",
  openImage: "画像/.aipaint 読み込み",
  openDirectImage: "画像を直接編集",
  undo: "アンドゥ",
  redo: "リドゥ",
  rotateCounterClockwise: "左回転",
  rotateClockwise: "右回転",
  horizontalFlip: "左右反転表示",
  subview: "サブビュー",
  reference: "リファレンス画像",
  drawingGuide: "描き方参照",
  colorAdjust: "色調補正",
  layoutSettings: "ウィンドウ配置設定",
  shortcutSettings: "ショートカット設定",
  save: "保存",
  export: "エクスポート",
  backup: "自動バックアップ",
  theme: "テーマ切替",
};

function sideOf(layout: LayoutConfig, id: RightSectionId): PanelSide {
  if (layout.leftSections.includes(id)) return "left";
  if (layout.rightSections.includes(id)) return "right";
  return "hidden";
}

function topBarSideOf(layout: LayoutConfig, id: TopBarItemId): PanelSide {
  if (layout.topBarLeftItems.includes(id)) return "left";
  if (layout.topBarRightItems.includes(id)) return "right";
  return "hidden";
}

function setSide(
  layout: LayoutConfig,
  id: RightSectionId,
  side: PanelSide
): LayoutConfig {
  const filter = (arr: RightSectionId[]) => arr.filter((x) => x !== id);
  const next: LayoutConfig = {
    ...layout,
    leftSections: filter(layout.leftSections),
    rightSections: filter(layout.rightSections),
    hidden: filter(layout.hidden),
  };
  if (side === "left") next.leftSections.push(id);
  else if (side === "right") next.rightSections.push(id);
  else next.hidden.push(id);
  return next;
}

function moveWithin(
  layout: LayoutConfig,
  id: RightSectionId,
  delta: number
): LayoutConfig {
  const side = sideOf(layout, id);
  const key =
    side === "left"
      ? "leftSections"
      : side === "right"
      ? "rightSections"
      : "hidden";
  const arr = layout[key].slice();
  const idx = arr.indexOf(id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= arr.length) return layout;
  const [it] = arr.splice(idx, 1);
  arr.splice(target, 0, it);
  return { ...layout, [key]: arr };
}

function setTopBarSide(
  layout: LayoutConfig,
  id: TopBarItemId,
  side: PanelSide
): LayoutConfig {
  if (id === REQUIRED_TOP_BAR_ITEM_ID && side === "hidden") return layout;
  const filter = (arr: TopBarItemId[]) => arr.filter((x) => x !== id);
  const next: LayoutConfig = {
    ...layout,
    topBarLeftItems: filter(layout.topBarLeftItems),
    topBarRightItems: filter(layout.topBarRightItems),
    topBarHiddenItems: filter(layout.topBarHiddenItems),
  };
  if (side === "left") next.topBarLeftItems.push(id);
  else if (side === "right") next.topBarRightItems.push(id);
  else next.topBarHiddenItems.push(id);
  return next;
}

function moveTopBarWithin(
  layout: LayoutConfig,
  id: TopBarItemId,
  delta: number
): LayoutConfig {
  const side = topBarSideOf(layout, id);
  const key =
    side === "left"
      ? "topBarLeftItems"
      : side === "right"
      ? "topBarRightItems"
      : "topBarHiddenItems";
  const arr = layout[key].slice();
  const idx = arr.indexOf(id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= arr.length) return layout;
  const [it] = arr.splice(idx, 1);
  arr.splice(target, 0, it);
  return { ...layout, [key]: arr };
}

interface Props {
  open: boolean;
  onClose: () => void;
  layout: LayoutConfig;
  setLayout: (l: LayoutConfig) => void;
}

export function LayoutSettings({
  open,
  onClose,
  layout,
  setLayout,
}: Props) {
  if (!open) return null;

  const reset = () => setLayout(DEFAULT_LAYOUT);

  const renderTopBarGroup = (side: PanelSide) => {
    const arr =
      side === "left"
        ? layout.topBarLeftItems
        : side === "right"
        ? layout.topBarRightItems
        : layout.topBarHiddenItems;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            fontWeight: 600,
          }}
        >
          {TOP_BAR_SIDE_LABEL[side]}（{arr.length}）
        </span>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 6,
            minHeight: 48,
            background: side === "hidden" ? "var(--panel-2)" : "transparent",
            opacity: side === "hidden" ? 0.75 : 1,
          }}
        >
          {arr.length === 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              （なし）
            </span>
          )}
          {arr.map((id, idx) => (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                background: "var(--panel-2)",
                borderRadius: 4,
              }}
            >
              <span style={{ flex: 1, fontSize: 12 }}>
                {TOP_BAR_LABEL[id]}
              </span>
              <button
                className="btn ghost"
                onClick={() => setLayout(moveTopBarWithin(layout, id, -1))}
                disabled={idx === 0 || side === "hidden"}
                style={{ padding: "2px 6px" }}
                title="上へ"
              >
                ↑
              </button>
              <button
                className="btn ghost"
                onClick={() => setLayout(moveTopBarWithin(layout, id, 1))}
                disabled={idx === arr.length - 1 || side === "hidden"}
                style={{ padding: "2px 6px" }}
                title="下へ"
              >
                ↓
              </button>
              <select
                className="select"
                value={side}
                onChange={(e) =>
                  setLayout(setTopBarSide(layout, id, e.target.value as PanelSide))
                }
                style={{ width: 88, padding: "2px 4px", fontSize: 11 }}
              >
                <option value="left">左</option>
                <option value="right">右</option>
                <option
                  value="hidden"
                  disabled={id === REQUIRED_TOP_BAR_ITEM_ID}
                >
                  非表示
                </option>
              </select>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderGroup = (side: PanelSide) => {
    const arrRaw =
      side === "left"
        ? layout.leftSections
        : side === "right"
        ? layout.rightSections
        : layout.hidden;
    const arr = arrRaw;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            fontWeight: 600,
          }}
        >
          {SIDE_LABEL[side]}（{arr.length}）
        </span>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 6,
            minHeight: 48,
            background: side === "hidden" ? "var(--panel-2)" : "transparent",
            opacity: side === "hidden" ? 0.75 : 1,
          }}
        >
          {arr.length === 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              （なし）
            </span>
          )}
          {arr.map((id, idx) => (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                background: "var(--panel-2)",
                borderRadius: 4,
              }}
            >
              <span style={{ flex: 1, fontSize: 12 }}>
                {SECTION_LABEL[id]}
              </span>
              <button
                className="btn ghost"
                onClick={() => setLayout(moveWithin(layout, id, -1))}
                disabled={idx === 0 || side === "hidden"}
                style={{ padding: "2px 6px" }}
                title="上へ"
              >
                ↑
              </button>
              <button
                className="btn ghost"
                onClick={() => setLayout(moveWithin(layout, id, 1))}
                disabled={idx === arr.length - 1 || side === "hidden"}
                style={{ padding: "2px 6px" }}
                title="下へ"
              >
                ↓
              </button>
              <select
                className="select"
                value={side}
                onChange={(e) =>
                  setLayout(setSide(layout, id, e.target.value as PanelSide))
                }
                style={{ width: 88, padding: "2px 4px", fontSize: 11 }}
              >
                <option value="left">左</option>
                <option value="right">右</option>
                <option value="hidden">非表示</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    );
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
          width: "min(720px, calc(100vw - 24px))",
          maxHeight: "80vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>ウィンドウ配置設定</strong>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            ツールバー（左の縦アイコン列）の位置
          </span>
          <div className="tabs">
            <button
              className={`tab ${!layout.flipped ? "active" : ""}`}
              onClick={() => setLayout({ ...layout, flipped: false })}
            >
              ツール: 左
            </button>
            <button
              className={`tab ${layout.flipped ? "active" : ""}`}
              onClick={() => setLayout({ ...layout, flipped: true })}
            >
              ツール: 右（全体ミラー）
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            上部アイコンを左側 / 右側 / 非表示に割り当て
          </span>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
            ウィンドウ配置設定は非表示にできません。
          </span>
          {renderTopBarGroup("left")}
          {renderTopBarGroup("right")}
          {renderTopBarGroup("hidden")}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            各セクションを左パネル / 右パネル / 非表示に割り当て
          </span>
          {renderGroup("left")}
          {renderGroup("right")}
          {renderGroup("hidden")}
        </div>

        <div
          style={{ display: "flex", gap: 6, justifyContent: "space-between" }}
        >
          <Button onClick={reset}>配置をリセット</Button>
          <Button variant="primary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </>
  );
}
