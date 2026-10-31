import type { LayerShortcutOptions, ShortcutHandlers } from "./types";

export function createLayerShortcutHandlers({
  doc,
  history,
}: LayerShortcutOptions): ShortcutHandlers {
  return {
    "layer.new": () => {
      if (!history || !doc) return;
      history.beginStructureOperation(doc);
      try {
        doc.addLayer();
        history.commitStructureOperation(doc, "レイヤー追加");
      } catch (e) {
        history.cancelOperation();
        throw e;
      }
    },
  };
}
