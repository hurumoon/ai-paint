import { describe, expect, it } from "vitest";
import { History } from "../../src/core/History";
import { PaintDocument } from "../../src/core/PaintDocument";

// 構造操作 (レイヤー追加/削除/並び替え/フォルダ/メタ) の履歴が、
// ピクセルを複製せず TileStore 実体の共有参照 + stash の所有権移動で
// undo/redo できることを検証する。
// (vitest は node 環境なので canvas を伴うピクセル経路はここでは扱わない)

function ids(doc: PaintDocument): string[] {
  return doc.layers.map((l) => l.meta.id);
}

function structured(
  fn: (doc: PaintDocument, history: History) => unknown,
  doc: PaintDocument,
  history: History,
  label = "op"
): void {
  history.beginStructureOperation(doc);
  const changed = fn(doc, history);
  if (changed === false) {
    history.cancelOperation();
  } else {
    history.commitStructureOperation(doc, label);
  }
}

describe("History structure operations", () => {
  it("restores layer order and active layer on undo/redo without copying stores", () => {
    const doc = new PaintDocument(8, 8, 3);
    const history = new History();
    const [a, b, c] = doc.layers;
    const storeA = a.store;
    const storeC = c.store;
    doc.setActiveLayer(c.meta.id);
    const beforeOrder = ids(doc);

    structured(() => doc.reorderLayer(a.meta.id, null, undefined), doc, history);
    expect(ids(doc)).toEqual([b.meta.id, c.meta.id, a.meta.id]);

    history.undo(doc);
    expect(ids(doc)).toEqual(beforeOrder);
    expect(doc.activeLayerId).toBe(c.meta.id);
    // ピクセル実体は複製されず、同じ TileStore が使い回される
    expect(doc.getLayer(a.meta.id)?.store).toBe(storeA);
    expect(doc.getLayer(c.meta.id)?.store).toBe(storeC);

    history.redo(doc);
    expect(ids(doc)).toEqual([b.meta.id, c.meta.id, a.meta.id]);
    expect(doc.getLayer(a.meta.id)?.store).toBe(storeA);
  });

  it("returns the removed layer's own store when a delete is undone", () => {
    const doc = new PaintDocument(8, 8, 2);
    const history = new History();
    const target = doc.layers[1];
    const store = target.store;

    structured(() => doc.removeLayer(target.meta.id), doc, history);
    expect(doc.getLayer(target.meta.id)).toBeUndefined();

    history.undo(doc);
    const restored = doc.getLayer(target.meta.id);
    expect(restored).toBeDefined();
    expect(restored?.store).toBe(store);
    expect(ids(doc)).toEqual([doc.layers[0].meta.id, target.meta.id]);

    history.redo(doc);
    expect(doc.getLayer(target.meta.id)).toBeUndefined();

    // 再度 undo しても同じ実体が戻る (stash の所有権が往復で維持される)
    history.undo(doc);
    expect(doc.getLayer(target.meta.id)?.store).toBe(store);
  });

  it("removes an added layer on undo and reinserts the same store on redo", () => {
    const doc = new PaintDocument(8, 8, 1);
    const history = new History();

    let addedId = "";
    structured(() => {
      addedId = doc.addLayer().meta.id;
    }, doc, history);
    const store = doc.getLayer(addedId)?.store;
    expect(store).toBeDefined();

    history.undo(doc);
    expect(doc.getLayer(addedId)).toBeUndefined();

    history.redo(doc);
    expect(doc.getLayer(addedId)?.store).toBe(store);
  });

  it("keeps store identity across an add → delete → full rewind/replay cycle", () => {
    const doc = new PaintDocument(8, 8, 1);
    const history = new History();

    let addedId = "";
    structured(() => {
      addedId = doc.addLayer("追加").meta.id;
    }, doc, history, "レイヤー追加");
    const store = doc.getLayer(addedId)?.store;

    structured(() => doc.removeLayer(addedId), doc, history, "レイヤー削除");
    expect(doc.getLayer(addedId)).toBeUndefined();

    history.undo(doc); // 削除を戻す
    expect(doc.getLayer(addedId)?.store).toBe(store);
    history.undo(doc); // 追加を戻す
    expect(doc.getLayer(addedId)).toBeUndefined();
    history.redo(doc); // 追加をやり直す
    expect(doc.getLayer(addedId)?.store).toBe(store);
    history.redo(doc); // 削除をやり直す
    expect(doc.getLayer(addedId)).toBeUndefined();
    history.undo(doc); // もう一度削除を戻す
    expect(doc.getLayer(addedId)?.store).toBe(store);
  });

  it("restores a deleted group together with its children", () => {
    const doc = new PaintDocument(8, 8, 1);
    const history = new History();
    const base = doc.layers[0];
    const group = doc.addGroup("G");
    doc.setActiveLayer(group.meta.id);
    const child = doc.addLayer("child");
    expect(child.meta.parentId).toBe(group.meta.id);
    const childStore = child.store;

    structured(() => doc.removeLayer(group.meta.id), doc, history);
    expect(ids(doc)).toEqual([base.meta.id]);

    history.undo(doc);
    expect(ids(doc)).toEqual([base.meta.id, group.meta.id, child.meta.id]);
    expect(doc.getLayer(child.meta.id)?.meta.parentId).toBe(group.meta.id);
    expect(doc.getLayer(child.meta.id)?.store).toBe(childStore);
  });

  it("restores meta from an isolated copy that later mutation cannot corrupt", () => {
    const doc = new PaintDocument(8, 8, 2);
    const history = new History();
    const target = doc.layers[0];
    expect(target.meta.clippingMask).toBeUndefined();

    structured(
      () => doc.setClippingMask(target.meta.id, true),
      doc,
      history,
      "クリッピング切替"
    );
    expect(doc.getLayer(target.meta.id)?.meta.clippingMask).toBe(true);

    history.undo(doc);
    expect(doc.getLayer(target.meta.id)?.meta.clippingMask ?? false).toBe(false);

    // undo 後にメタを直接いじっても、redo はスナップショット時点の値を再現する
    doc.updateLayerMeta(target.meta.id, { name: "書き換え" });
    history.redo(doc);
    expect(doc.getLayer(target.meta.id)?.meta.clippingMask).toBe(true);
  });

  it("re-accounts stash bytes when undoing an add moves a populated store into history", () => {
    const doc = new PaintDocument(8, 8, 1);
    const history = new History();
    history.setMemoryBudget(64 * 1024);

    // 3 つの構造エントリ (レイヤー追加 ×3)。push 時点では stash が空なので
    // どれも計上はメタ分のみで、予算には収まる。
    const added: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      structured(() => {
        added.push(doc.addLayer(`L${i}`).meta.id);
      }, doc, history, `追加${i}`);
    }

    // 最後に追加したレイヤーが大きなピクセルを持っていた、を模擬する
    // (node 環境では canvas を実体化できないため概算サイズだけ差し替える)
    const bigLayer = doc.getLayer(added[2]);
    if (!bigLayer) throw new Error("added layer missing");
    bigLayer.store.getApproxByteSize = () => 10 * 1024 * 1024;

    // undo で大きな実体が stash (redo 側) へ移る → 差分計上で予算超過となり、
    // 最古の undo エントリが間引かれる。残りの undo は 1 回だけになる。
    history.undo(doc);
    expect(doc.getLayer(added[2])).toBeUndefined();

    expect(history.canUndo()).toBe(true);
    history.undo(doc);
    expect(history.canUndo()).toBe(false);

    // redo で実体が doc に戻れば計上も戻る
    history.redo(doc);
    history.redo(doc);
    expect(doc.getLayer(added[2])?.store).toBe(bigLayer.store);
  });

  it("discards the pending structure operation on cancel", () => {
    const doc = new PaintDocument(8, 8, 1);
    const history = new History();

    history.beginStructureOperation(doc);
    history.cancelOperation();
    history.commitStructureOperation(doc, "no-op");

    expect(history.canUndo()).toBe(false);
  });
});
