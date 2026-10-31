import { PaintDocument, PixelLayer } from "../../core/PaintDocument";
import { History } from "../../core/History";
import { IconButton } from "../../ui/primitives";
import {
  IconClip,
  IconFolder,
  IconIndentIn,
  IconIndentOut,
  IconMerge,
  IconPlus,
  IconTrash,
  IconTransparentLock,
} from "../../ui/Icons";
import {
  canMergeDown,
  canRemoveLayer,
  findIndentTarget,
  withStructureHistory,
} from "./LayerPanelModel";

interface Props {
  doc: PaintDocument;
  history: History;
  active: PixelLayer | undefined;
}

export function LayerPanelActions({ doc, history, active }: Props) {
  const mergeDownEnabled = canMergeDown(doc, active);
  const removeEnabled = canRemoveLayer(doc, active);

  return (
    <div className="layer-actions">
      <IconButton
        title="新規レイヤー"
        onClick={() =>
          withStructureHistory(doc, history, "レイヤー追加", () => doc.addLayer())
        }
      >
        <IconPlus />
      </IconButton>
      <IconButton
        title="新規フォルダ"
        onClick={() =>
          withStructureHistory(doc, history, "フォルダ追加", () => doc.addGroup())
        }
      >
        <IconFolder />
      </IconButton>
      <IconButton
        title="フォルダに入れる"
        onClick={() => {
          if (!active) return;
          const target = findIndentTarget(doc, active);
          if (!target) return;
          withStructureHistory(doc, history, "フォルダに入れる", () =>
            doc.setLayerParent(active.meta.id, target.meta.id)
          );
        }}
        disabled={!active || !findIndentTarget(doc, active)}
      >
        <IconIndentIn />
      </IconButton>
      <IconButton
        title="フォルダから出す"
        onClick={() =>
          active &&
          active.meta.parentId &&
          withStructureHistory(doc, history, "フォルダから出す", () =>
            doc.setLayerParent(active.meta.id, null)
          )
        }
        disabled={!active || !active.meta.parentId}
      >
        <IconIndentOut />
      </IconButton>
      <IconButton
        title={
          active?.meta.clippingMask
            ? "クリッピングマスクを解除"
            : "下のレイヤーにクリップ"
        }
        active={!!active?.meta.clippingMask}
        onClick={() =>
          active &&
          withStructureHistory(doc, history, "クリッピング切替", () =>
            doc.setClippingMask(active.meta.id, !active.meta.clippingMask)
          )
        }
        disabled={!active || active.meta.kind === "group"}
      >
        <IconClip />
      </IconButton>
      <IconButton
        title={
          active?.meta.transparentPixelLock
            ? "透明ピクセルロックを解除"
            : "透明ピクセルをロック"
        }
        active={!!active?.meta.transparentPixelLock}
        onClick={() =>
          active &&
          history.recordMetaChange(
            doc,
            [active.meta.id],
            "透明ピクセルロック切替",
            () =>
              doc.setTransparentPixelLock(
                active.meta.id,
                !active.meta.transparentPixelLock
              )
          )
        }
        disabled={!active || active.meta.kind === "group"}
      >
        <IconTransparentLock />
      </IconButton>
      <IconButton
        title="下と結合"
        data-testid="layer-merge-down"
        onClick={() => {
          if (!active) return;
          // 結合はピクセルが「下側レイヤー」だけ変わる構造操作。
          // そのレイヤーだけ before/after のピクセルを履歴に撮る。
          const idx = doc.layers.findIndex((l) => l.meta.id === active.meta.id);
          const lower = idx > 0 ? doc.layers[idx - 1] : undefined;
          if (!lower) return;
          withStructureHistory(
            doc,
            history,
            "レイヤー結合",
            () => doc.mergeDown(active.meta.id),
            { pixelLayerIds: [lower.meta.id] }
          );
        }}
        disabled={!mergeDownEnabled}
      >
        <IconMerge />
      </IconButton>
      <IconButton
        title="削除"
        onClick={() =>
          active &&
          withStructureHistory(doc, history, "レイヤー削除", () =>
            doc.removeLayer(active.meta.id)
          )
        }
        disabled={!removeEnabled}
      >
        <IconTrash />
      </IconButton>
    </div>
  );
}
