import { describe, expect, it, vi } from "vitest";
import { handleWindowCloseRequest } from "../../src/hooks/useWindowCloseGuard";
import { TabStore } from "../../src/hooks/useTabs";

function makeDirty(tab: ReturnType<TabStore["addBlankTab"]>): void {
  const layer = tab.doc.layers[0];
  tab.history.recordMetaChange(tab.doc, [layer.meta.id], "dirty", () => {
    tab.doc.setOpacity(layer.meta.id, 0.5);
  });
}

describe("window close guard", () => {
  it("does not intercept closing when every tab is clean", async () => {
    const tabStore = new TabStore(1024);
    tabStore.addBlankTab(1, 1);
    const preventDefault = vi.fn();
    const destroy = vi.fn(async () => undefined);

    await expect(
      handleWindowCloseRequest({
        tabStore,
        preventDefault,
        ask: vi.fn(async () => true),
        confirm: vi.fn(() => true),
        destroy,
      })
    ).resolves.toBe(false);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("lists every dirty tab and keeps the window open when confirmation is denied", async () => {
    const tabStore = new TabStore(1024);
    const first = tabStore.addBlankTab(1, 1);
    const second = tabStore.addBlankTab(1, 1);
    tabStore.updateTab(second.id, { fileName: "work.psd" });
    makeDirty(first);
    makeDirty(second);
    const ask = vi.fn(async () => false);
    const destroy = vi.fn(async () => undefined);

    await handleWindowCloseRequest({
      tabStore,
      preventDefault: vi.fn(),
      ask,
      confirm: vi.fn(() => true),
      destroy,
    });

    expect(ask).toHaveBeenCalledWith(expect.stringContaining("2 個のタブ"));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("名称未設定1"));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("work.psd"));
    expect(destroy).not.toHaveBeenCalled();
  });

  it("falls back to confirm and destroys the window only after approval", async () => {
    const tabStore = new TabStore(1024);
    const tab = tabStore.addBlankTab(1, 1);
    makeDirty(tab);
    const preventDefault = vi.fn();
    const confirm = vi.fn(() => true);
    const destroy = vi.fn(async () => undefined);

    await expect(
      handleWindowCloseRequest({
        tabStore,
        preventDefault,
        ask: vi.fn(async () => {
          throw new Error("dialog unavailable");
        }),
        confirm,
        destroy,
      })
    ).resolves.toBe(true);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("名称未設定1"));
    expect(destroy).toHaveBeenCalledOnce();
  });
});
