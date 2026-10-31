import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { createCanvas } from "./canvas-helpers";

type LayerFixture = {
  id: string;
  name: string;
  kind: "raster" | "group";
  parentId?: string;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
});

test("creates a folder with a child layer and restores it through undo and redo", async ({
  page,
}) => {
  await createCanvas(page, { width: 32, height: 24, dpi: 144 });

  await expect(layerRows(page)).toHaveCount(1);
  await page.getByTitle("新規フォルダ").click();
  await expect(layerRows(page)).toHaveCount(2);
  await expect(page.locator(".layer-counts")).toContainText("フォルダ: 1");

  await page.getByTitle("新規レイヤー").click();
  await expect(layerRows(page)).toHaveCount(3);
  await expect(page.locator(".layer-counts")).toContainText("レイヤー: 2");

  await collapseGroup(page, "フォルダ1");
  await expect(layerRows(page)).toHaveCount(2);
  await collapseGroup(page, "フォルダ1");

  await page.keyboard.press("Control+Z");
  await expect(layerRows(page)).toHaveCount(2);
  await expect(page.locator(".layer-counts")).toContainText("レイヤー: 1");

  await page.keyboard.press("Control+Y");
  await expect(layerRows(page)).toHaveCount(3);
  await expect(page.locator(".layer-counts")).toContainText("レイヤー: 2");
});

test("moves a deeply nested child directly into an ancestor group", async ({ page }) => {
  await openProject(page, [
    raster("bottom"),
    group("outer"),
    raster("outer-low", "outer"),
    group("inner", "outer"),
    raster("inner-low", "inner"),
    raster("moving", "inner"),
    raster("inner-high", "inner"),
    raster("outer-high", "outer"),
    raster("top"),
  ]);

  await dragLayer(page, "moving", "outer", "inside");

  await collapseGroup(page, "inner");
  await expectVisibleLayerNames(page, [
    "top",
    "moving",
    "outer-high",
    "inner",
    "outer-low",
    "outer",
    "bottom",
  ]);

  await collapseGroup(page, "outer");
  await expectVisibleLayerNames(page, ["top", "outer", "bottom"]);
});

test("moves a group with descendants out of its parent without splitting the subtree", async ({
  page,
}) => {
  await openProject(page, [
    raster("bottom"),
    group("outer"),
    raster("outer-low", "outer"),
    group("moving-group", "outer"),
    raster("child-low", "moving-group"),
    group("child-group", "moving-group"),
    raster("grandchild", "child-group"),
    raster("child-high", "moving-group"),
    raster("outer-high", "outer"),
    raster("top"),
  ]);

  await dragLayer(page, "moving-group", "top", "after");

  await collapseGroup(page, "outer");
  await expectVisibleLayerNames(page, [
    "top",
    "child-high",
    "grandchild",
    "child-group",
    "child-low",
    "moving-group",
    "outer",
    "bottom",
  ]);

  await collapseGroup(page, "moving-group");
  await expectVisibleLayerNames(page, ["top", "moving-group", "outer", "bottom"]);
});

test("moves a layer from one group into an unrelated group", async ({ page }) => {
  await openProject(page, [
    raster("bottom"),
    group("source"),
    raster("source-low", "source"),
    raster("moving", "source"),
    raster("source-high", "source"),
    group("destination"),
    raster("destination-low", "destination"),
    raster("destination-high", "destination"),
    raster("top"),
  ]);

  await dragLayer(page, "moving", "destination", "inside");

  await collapseGroup(page, "source");
  await expectVisibleLayerNames(page, [
    "top",
    "moving",
    "destination-high",
    "destination-low",
    "destination",
    "source",
    "bottom",
  ]);

  await collapseGroup(page, "destination");
  await expectVisibleLayerNames(page, ["top", "destination", "source", "bottom"]);
});

test("indents and outdents a layer with button actions and history", async ({
  page,
}) => {
  await openProject(page, [
    raster("bottom"),
    group("folder"),
    raster("moving"),
    raster("top"),
  ]);

  await layerRow(page, "moving").click();
  await expect(layerRow(page, "moving")).toHaveCSS("padding-left", "4px");

  await page.getByTitle("フォルダに入れる").click();
  await expect(layerRow(page, "moving")).toHaveCSS("padding-left", "18px");

  await page.keyboard.press("Control+Z");
  await expect(layerRow(page, "moving")).toHaveCSS("padding-left", "4px");

  await page.keyboard.press("Control+Y");
  await expect(layerRow(page, "moving")).toHaveCSS("padding-left", "18px");

  await page.getByTitle("フォルダから出す").click();
  await expect(layerRow(page, "moving")).toHaveCSS("padding-left", "4px");
});

test("undoes and redoes a drag between unrelated groups", async ({ page }) => {
  await openProject(page, [
    raster("bottom"),
    group("source"),
    raster("moving", "source"),
    group("destination"),
    raster("destination-child", "destination"),
    raster("top"),
  ]);

  await dragLayer(page, "moving", "destination", "inside");
  await expectVisibleLayerNames(page, [
    "top",
    "moving",
    "destination-child",
    "destination",
    "source",
    "bottom",
  ]);

  await page.keyboard.press("Control+Z");
  await expectVisibleLayerNames(page, [
    "top",
    "destination-child",
    "destination",
    "moving",
    "source",
    "bottom",
  ]);

  await page.keyboard.press("Control+Y");
  await expectVisibleLayerNames(page, [
    "top",
    "moving",
    "destination-child",
    "destination",
    "source",
    "bottom",
  ]);
});

test("deletes a group subtree and restores every descendant through history", async ({
  page,
}) => {
  await openProject(page, [
    raster("bottom"),
    group("folder"),
    raster("child", "folder"),
    group("nested", "folder"),
    raster("grandchild", "nested"),
    raster("top"),
  ]);

  await layerRow(page, "folder").click();
  await page.getByTitle("削除").click();
  await expectVisibleLayerNames(page, ["top", "bottom"]);
  await expect(page.locator(".layer-counts")).toContainText("フォルダ: 0");

  await page.keyboard.press("Control+Z");
  await expectVisibleLayerNames(page, [
    "top",
    "grandchild",
    "nested",
    "child",
    "folder",
    "bottom",
  ]);
  await expect(page.locator(".layer-counts")).toContainText("フォルダ: 2");

  await page.keyboard.press("Control+Y");
  await expectVisibleLayerNames(page, ["top", "bottom"]);
});

test("rejects dragging a group into one of its descendants", async ({ page }) => {
  await openProject(page, [
    raster("bottom"),
    group("outer"),
    group("inner", "outer"),
    raster("leaf", "inner"),
    raster("top"),
  ]);

  await dragLayer(page, "outer", "inner", "inside");
  await expectVisibleLayerNames(page, [
    "top",
    "leaf",
    "inner",
    "outer",
    "bottom",
  ]);

  await collapseGroup(page, "outer");
  await expectVisibleLayerNames(page, ["top", "outer", "bottom"]);
});

test("keeps exact sibling order when several peer layers surround the moved layer", async ({
  page,
}) => {
  await openProject(page, [
    raster("bottom"),
    group("group"),
    raster("first", "group"),
    raster("before-moving", "group"),
    raster("moving", "group"),
    raster("after-moving", "group"),
    raster("last", "group"),
    raster("top"),
  ]);

  await dragLayer(page, "moving", "last", "before");
  await expectVisibleLayerNames(page, [
    "top",
    "moving",
    "last",
    "after-moving",
    "before-moving",
    "first",
    "group",
    "bottom",
  ]);

  await dragLayer(page, "moving", "first", "after");
  await expectVisibleLayerNames(page, [
    "top",
    "last",
    "after-moving",
    "before-moving",
    "first",
    "moving",
    "group",
    "bottom",
  ]);
});

test("rejects missing parents and parent cycles without replacing the open document", async ({
  page,
}) => {
  await openProject(page, [raster("baseline")]);

  await uploadProject(
    page,
    invalidProjectBuffer([
      raster("orphan", "missing-group"),
    ]),
    "missing-parent.aipaint"
  );
  await expect(page.locator(".toast.error")).toContainText(
    "レイヤー orphan の親IDが不正です"
  );
  await expectVisibleLayerNames(page, ["baseline"]);

  await uploadProject(
    page,
    invalidProjectBuffer([
      group("cycle-a", "cycle-b"),
      group("cycle-b", "cycle-a"),
      raster("safe-layer"),
    ], "safe-layer"),
    "parent-cycle.aipaint"
  );
  await expect(page.locator(".toast.error").last()).toContainText(
    "レイヤーの親子関係が循環しています"
  );
  await expectVisibleLayerNames(page, ["baseline"]);
});

function raster(name: string, parentId?: string): LayerFixture {
  return { id: name, name, kind: "raster", parentId };
}

function group(name: string, parentId?: string): LayerFixture {
  return { id: name, name, kind: "group", parentId };
}

function projectBuffer(layers: LayerFixture[], activeLayerId?: string): Buffer {
  const activeId =
    activeLayerId ??
    [...layers].reverse().find((layer) => layer.kind === "raster")?.id ??
    layers[0]?.id;
  return invalidProjectBuffer(layers, activeId);
}

function invalidProjectBuffer(
  layers: LayerFixture[],
  activeLayerId = layers[0]?.id
): Buffer {
  const manifest = {
    magic: "aipaint-v2",
    version: 2,
    width: 8,
    height: 8,
    dpi: 96,
    activeLayerId,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      locked: false,
      kind: layer.kind,
      parentId: layer.parentId,
      ...(layer.kind === "raster" ? { empty: true } : {}),
    })),
  };
  return Buffer.from(
    zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
    })
  );
}

async function openProject(page: Page, layers: LayerFixture[]): Promise<void> {
  await uploadProject(page, projectBuffer(layers), "layer-hierarchy.aipaint");
  await expect(layerRows(page)).toHaveCount(layers.length);
}

async function uploadProject(
  page: Page,
  buffer: Buffer,
  name: string
): Promise<void> {
  await page.getByTestId("project-file-input").setInputFiles({
    name,
    mimeType: "application/x-aipaint",
    buffer,
  });
}

function layerRows(page: Page) {
  return page.getByTestId("layer-row");
}

function layerRow(page: Page, name: string) {
  return page.locator(`[data-testid="layer-row"][data-layer-name="${name}"]`);
}

async function dragLayer(
  page: Page,
  sourceName: string,
  targetName: string,
  position: "before" | "after" | "inside"
): Promise<void> {
  await page.evaluate(({ sourceName, targetName, position }) => {
    const row = (name: string): HTMLElement | null =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="layer-row"]')
      ).find((candidate) => candidate.dataset.layerName === name) ?? null;
    const source = row(sourceName);
    const target = row(targetName);
    if (!source) throw new Error(`drag source was not visible: ${sourceName}`);
    if (!target) throw new Error(`drop target was not visible: ${targetName}`);

    const rect = target.getBoundingClientRect();
    const yRatio = position === "before" ? 0.1 : position === "after" ? 0.9 : 0.5;
    const dataTransfer = new DataTransfer();
    const targetEvent = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * yRatio,
    };
    source.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
    target.dispatchEvent(new DragEvent("dragover", targetEvent));
    target.dispatchEvent(new DragEvent("drop", targetEvent));
    source.dispatchEvent(
      new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
  }, {
    sourceName,
    targetName,
    position,
  });
}

async function collapseGroup(page: Page, name: string): Promise<void> {
  await layerRow(page, name).locator(".visibility").first().click();
}

async function expectVisibleLayerNames(
  page: Page,
  expected: string[]
): Promise<void> {
  await expect
    .poll(() =>
      layerRows(page).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-layer-name"))
      )
    )
    .toEqual(expected);
}
