import { useRef, useState } from "react";
import { PaintDocument, PixelLayer } from "../core/PaintDocument";
import { History } from "../core/History";
import { ActiveLayerControls } from "./layers/ActiveLayerControls";
import { LayerList } from "./layers/LayerList";
import { LayerPanelActions } from "./layers/LayerPanelActions";
import {
  DisplayRow,
  DropPos,
  DropTarget,
  buildDisplayRows,
  findSiblingRow,
  isSelfOrDescendant,
  withStructureHistory,
} from "./layers/LayerPanelModel";

interface Props {
  doc: PaintDocument;
  history: History;
}

export function LayerPanel({ doc, history }: Props) {
  const active = doc.getActiveLayer();
  const rows = buildDisplayRows(doc);
  let groupCount = 0;
  let layerCount = 0;
  for (const l of doc.layers) {
    if (l.meta.kind === "group") groupCount += 1;
    else layerCount += 1;
  }

  // state は表示用 (drag/drop ハイライト)。ハンドラのロジックは ref を見る。
  // 理由: onDragStart で setState しても、その直後に同期発火する onDragOver は
  // setState 反映前のクロージャを参照して draggingId が null のままになる。
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // dragover で呼ばれる。row 内の Y 座標からドロップ位置を決める。
  const computeDropTarget = (
    e: React.DragEvent<HTMLDivElement>,
    row: DisplayRow
  ): DropTarget | null => {
    const dragId = draggingIdRef.current;
    if (!dragId) return null;
    // 自分自身/子孫の上にはドロップさせない（循環）
    if (isSelfOrDescendant(doc, dragId, row.layer.meta.id)) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const isGroup = row.layer.meta.kind === "group";
    let pos: DropPos;
    if (isGroup) {
      // group 行: 上 25% / 中央 50% / 下 25%
      if (y < h * 0.25) pos = "before";
      else if (y > h * 0.75) pos = "after";
      else pos = "inside";
    } else {
      pos = y < h * 0.5 ? "before" : "after";
    }
    return { rowId: row.layer.meta.id, pos };
  };

  // D&D 結果を適用する。
  const applyDrop = (target: DropTarget): void => {
    const dragId = draggingIdRef.current;
    if (!dragId) return;
    const dragging = doc.getLayer(dragId);
    if (!dragging) return;
    const targetRow = doc.getLayer(target.rowId);
    if (!targetRow) return;
    if (isSelfOrDescendant(doc, dragId, target.rowId)) return;

    // 「動かす先 (parentId, beforeId)」を計算
    let newParentId: string | null | undefined;
    let beforeId: string | undefined;

    if (target.pos === "inside") {
      // group の中に入れる。group 配下の UI 最上 = 配列末尾に置く（= beforeId なし）
      newParentId = target.rowId;
      beforeId = undefined;
    } else {
      // before/after は「同じ親のリスト内での位置」を表す
      newParentId = targetRow.meta.parentId ?? null;
      const targetIdx = doc.layers.indexOf(targetRow);
      if (target.pos === "after") {
        // UI で下側 = 配列で targetRow の前に挿入
        // reorderLayer の beforeId は「この id の配列上の直前に入れる」
        beforeId = targetRow.meta.id;
      } else {
        // UI で上側 = 配列で targetRow の次のレイヤー (同 parent) の前に挿入
        // 同じ親の次のレイヤーを探す
        let next: PixelLayer | undefined;
        for (let i = targetIdx + 1; i < doc.layers.length; i += 1) {
          const cand = doc.layers[i];
          if (cand.meta.parentId === targetRow.meta.parentId) {
            next = cand;
            break;
          }
          // 同 parent でない領域に入ったら、それは別グループの内側か外側。
          // 別グループの中身は飛び越えたい (= もっと外側を探す)。
          // ただし同 parent じゃないけど「外」に出る場合はもう同階層の隣がいない = 末尾。
        }
        beforeId = next?.meta.id; // undefined なら同 parent の末尾 = UI 最上
      }
    }

    withStructureHistory(doc, history, "レイヤー並び替え", () =>
      doc.reorderLayer(dragId, newParentId, beforeId)
    );
  };

  // 上下ボタンで同階層の隣レイヤーと位置を入れ替える。
  // UI の「ひとつ上」= 配列で見ると後ろの隣接同階層レイヤー、
  // 「ひとつ下」= 前の隣接同階層レイヤー。
  const moveLayer = (layer: PixelLayer, direction: "up" | "down"): void => {
    const sibling = findSiblingRow(rows, layer, direction);
    if (!sibling) return;
    const newParentId = layer.meta.parentId ?? null;
    let beforeId: string | undefined;
    if (direction === "up") {
      // sibling は UI で上 = 配列では layer の後ろ。
      // sibling の「さらに UI で上 = 配列で sibling の次」の同階層レイヤーの前に挿入したい。
      const siblingIdx = doc.layers.indexOf(sibling.layer);
      let next: PixelLayer | undefined;
      for (let i = siblingIdx + 1; i < doc.layers.length; i += 1) {
        const cand = doc.layers[i];
        if (cand.meta.parentId === layer.meta.parentId) {
          next = cand;
          break;
        }
      }
      beforeId = next?.meta.id; // undefined なら sibling より上はないので末尾(UI 最上)
    } else {
      // 下 = sibling の配列上「前」に置く = sibling の id を beforeId に
      beforeId = sibling.layer.meta.id;
    }
    withStructureHistory(doc, history, "レイヤー移動", () =>
      doc.reorderLayer(layer.meta.id, newParentId, beforeId)
    );
  };

  return (
    <div className="section">
      <div className="section-title">
        <span>レイヤー</span>
        <LayerPanelActions doc={doc} history={history} active={active} />
      </div>

      <div className="layer-counts">
        <span>レイヤー: {layerCount}</span>
        <span>フォルダ: {groupCount}</span>
      </div>

      <LayerList
        doc={doc}
        history={history}
        rows={rows}
        draggingId={draggingId}
        dropTarget={dropTarget}
        draggingIdRef={draggingIdRef}
        dropTargetRef={dropTargetRef}
        listRef={listRef}
        setDraggingId={setDraggingId}
        setDropTarget={setDropTarget}
        computeDropTarget={computeDropTarget}
        applyDrop={applyDrop}
        moveLayer={moveLayer}
      />

      <ActiveLayerControls
        active={active}
        onChangeOpacity={(layerId, opacity) => doc.setOpacity(layerId, opacity)}
        onChangeBlendMode={(layerId, blendMode) =>
          doc.setBlendMode(layerId, blendMode)
        }
      />
    </div>
  );
}
