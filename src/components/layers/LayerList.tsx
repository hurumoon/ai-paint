import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { PaintDocument, PixelLayer } from "../../core/PaintDocument";
import { History } from "../../core/History";
import { IconButton } from "../../ui/primitives";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconClip,
  IconEye,
  IconEyeOff,
  IconTransparentLock,
} from "../../ui/Icons";
import { DisplayRow, DropTarget, findSiblingRow } from "./LayerPanelModel";
import { LayerThumb } from "./LayerThumb";

interface Props {
  doc: PaintDocument;
  history: History;
  rows: DisplayRow[];
  draggingId: string | null;
  dropTarget: DropTarget | null;
  draggingIdRef: MutableRefObject<string | null>;
  dropTargetRef: MutableRefObject<DropTarget | null>;
  listRef: MutableRefObject<HTMLDivElement | null>;
  setDraggingId: Dispatch<SetStateAction<string | null>>;
  setDropTarget: Dispatch<SetStateAction<DropTarget | null>>;
  computeDropTarget: (
    e: React.DragEvent<HTMLDivElement>,
    row: DisplayRow
  ) => DropTarget | null;
  applyDrop: (target: DropTarget) => void;
  moveLayer: (layer: PixelLayer, direction: "up" | "down") => void;
}

export function LayerList({
  doc,
  history,
  rows,
  draggingId,
  dropTarget,
  draggingIdRef,
  dropTargetRef,
  listRef,
  setDraggingId,
  setDropTarget,
  computeDropTarget,
  applyDrop,
  moveLayer,
}: Props) {
  return (
    <div className="layer-list" ref={listRef}>
      {rows.map(({ layer, depth }) => {
        const isActive = layer.meta.id === doc.activeLayerId;
        const isGroup = layer.meta.kind === "group";
        const isDragging = draggingId === layer.meta.id;
        const isDropHere = dropTarget?.rowId === layer.meta.id;
        const dropClass = isDropHere ? `drop-${dropTarget!.pos}` : "";
        return (
          <div
            key={layer.meta.id}
            className={`layer-row ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""} ${dropClass}`}
            data-testid="layer-row"
            data-layer-name={layer.meta.name}
            data-active={isActive ? "true" : "false"}
            draggable
            onClick={() => doc.setActiveLayer(layer.meta.id)}
            onDragStart={(e) => {
              draggingIdRef.current = layer.meta.id;
              setDraggingId(layer.meta.id);
              e.dataTransfer.effectAllowed = "move";
              // Firefox は dataTransfer に何かセットしないと drag が始まらない
              e.dataTransfer.setData("text/plain", layer.meta.id);
            }}
            onDragEnd={() => {
              draggingIdRef.current = null;
              dropTargetRef.current = null;
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragOver={(e) => {
              if (!draggingIdRef.current) return;
              // ドラッグ中はこの領域全体をドロップ可能として扱う。
              // 「自分自身/子孫の上」など computeDropTarget が null を返すケースでも
              // preventDefault を呼ばないとブラウザは「どこにもドロップできない」と
              // 判断し、ドラッグ自体をキャンセルしてしまう。
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const t = computeDropTarget(e, { layer, depth });
              const prev = dropTargetRef.current;
              if (!t) {
                if (prev) {
                  dropTargetRef.current = null;
                  setDropTarget(null);
                }
                return;
              }
              if (!prev || prev.rowId !== t.rowId || prev.pos !== t.pos) {
                dropTargetRef.current = t;
                setDropTarget(t);
              }
            }}
            onDrop={(e) => {
              if (!draggingIdRef.current) return;
              e.preventDefault();
              const t = computeDropTarget(e, { layer, depth });
              if (t) applyDrop(t);
              draggingIdRef.current = null;
              dropTargetRef.current = null;
              setDraggingId(null);
              setDropTarget(null);
            }}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {isGroup ? (
              <span
                className="visibility"
                onClick={(e) => {
                  e.stopPropagation();
                  doc.setGroupCollapsed(layer.meta.id, !layer.meta.collapsed);
                }}
                title={layer.meta.collapsed ? "開く" : "閉じる"}
              >
                {layer.meta.collapsed ? (
                  <IconChevronRight width={14} height={14} />
                ) : (
                  <IconChevronDown width={14} height={14} />
                )}
              </span>
            ) : (
              <div className="thumb">
                <LayerThumb
                  layer={layer}
                  docWidth={doc.width}
                  docHeight={doc.height}
                />
              </div>
            )}
            <span
              className={`visibility ${!layer.meta.visible ? "hidden" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                // visible はメタ変更のみで ImageData も順序も変えないので、
                // メタ専用の軽量経路を使う。
                history.recordMetaChange(
                  doc,
                  [layer.meta.id],
                  "表示切替",
                  () => doc.setVisibility(layer.meta.id, !layer.meta.visible)
                );
              }}
              title={layer.meta.visible ? "非表示にする" : "表示する"}
            >
              {layer.meta.visible ? (
                <IconEye width={14} height={14} />
              ) : (
                <IconEyeOff width={14} height={14} />
              )}
            </span>
            <span className="name">
              {isGroup ? "📁 " : ""}
              {layer.meta.clippingMask && (
                <span
                  className="clip-indicator"
                  title="下のレイヤーにクリッピング"
                >
                  <IconClip width={11} height={11} />
                </span>
              )}
              {layer.meta.transparentPixelLock && (
                <span
                  className="transparent-lock-indicator"
                  title="透明ピクセルロック"
                >
                  <IconTransparentLock width={11} height={11} />
                </span>
              )}
              {layer.meta.name}
            </span>
            {layer.meta.blendMode !== "normal" && (
              <span className="badge">{layer.meta.blendMode}</span>
            )}
            <div className="layer-row-move">
              <IconButton
                title="上に移動"
                data-testid="layer-move-up"
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer, "up");
                }}
                disabled={!findSiblingRow(rows, layer, "up")}
              >
                <IconArrowUp width={12} height={12} />
              </IconButton>
              <IconButton
                title="下に移動"
                data-testid="layer-move-down"
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer, "down");
                }}
                disabled={!findSiblingRow(rows, layer, "down")}
              >
                <IconArrowDown width={12} height={12} />
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
