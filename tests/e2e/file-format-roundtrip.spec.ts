import { expect, test } from "@playwright/test";

test("loads .aipaint, saves PSD, reloads PSD, saves .aipaint, and reloads it", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadAiPaint, saveAiPaint } = await import("/src/core/nativeFormat.ts");
    const { loadPsd, savePsd } = await import("/src/core/psdFormat.ts");

    function makeDocumentLayerCanvas(
      width: number,
      height: number,
      rect: { x: number; y: number; w: number; h: number },
      rgba: readonly [number, number, number, number]
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      const image = ctx.createImageData(width, height);
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) {
          const index = (y * width + x) * 4;
          image.data[index] = rgba[0];
          image.data[index + 1] = rgba[1];
          image.data[index + 2] = rgba[2];
          image.data[index + 3] = rgba[3];
        }
      }
      ctx.putImageData(image, 0, 0);
      return { canvas, ctx };
    }

    function pixel(data: ImageData, x: number, y: number): number[] {
      const index = (y * data.width + x) * 4;
      return Array.from(data.data.slice(index, index + 4));
    }

    function sampleLayerPixel(doc: InstanceType<typeof PaintDocument>, name: string, x: number, y: number) {
      const layer = doc.layers.find((item) => item.meta.name === name);
      if (!layer) throw new Error(`layer was not found: ${name}`);
      doc.materializeLayer(layer);
      return {
        bounds: layer.store.getAlphaBounds(),
        pixel: pixel(layer.store.getImageData(0, 0, doc.width, doc.height), x, y),
      };
    }

    const width = 12;
    const height = 9;
    const bottomCanvas = makeDocumentLayerCanvas(
      width,
      height,
      { x: 2, y: 1, w: 3, h: 2 },
      [210, 40, 30, 255]
    );
    const topCanvas = makeDocumentLayerCanvas(
      width,
      height,
      { x: 7, y: 4, w: 2, h: 3 },
      [30, 80, 220, 255]
    );
    const source = new PaintDocument(width, height, 1);
    source.setDpi(192);
    source.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "bottom-red",
            name: "bottom red",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: bottomCanvas.canvas,
          ctx: bottomCanvas.ctx,
        },
        {
          meta: {
            id: "top-blue",
            name: "top blue",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: topCanvas.canvas,
          ctx: topCanvas.ctx,
        },
      ],
      "top-blue"
    );

    const sourceAipaint = await saveAiPaint(source);
    const loadedAipaint = new PaintDocument(1, 1, 1);
    await loadAiPaint(sourceAipaint, loadedAipaint);

    const psd = await savePsd(loadedAipaint);
    const loadedPsd = new PaintDocument(1, 1, 1);
    await loadPsd(psd, loadedPsd);

    const roundtripAipaint = await saveAiPaint(loadedPsd);
    const finalDoc = new PaintDocument(1, 1, 1);
    await loadAiPaint(roundtripAipaint, finalDoc);

    return {
      sourceAipaint: { type: sourceAipaint.type, size: sourceAipaint.size },
      psd: { type: psd.type, size: psd.size },
      roundtripAipaint: { type: roundtripAipaint.type, size: roundtripAipaint.size },
      finalDoc: {
        width: finalDoc.width,
        height: finalDoc.height,
        dpi: finalDoc.dpi,
        activeLayerName: finalDoc.getActiveLayer()?.meta.name,
        layerNames: finalDoc.layers.map((layer) => layer.meta.name),
      },
      bottom: sampleLayerPixel(finalDoc, "bottom red", 2, 1),
      top: sampleLayerPixel(finalDoc, "top blue", 7, 4),
    };
  });

  expect(result.sourceAipaint.type).toBe("application/x-aipaint");
  expect(result.sourceAipaint.size).toBeGreaterThan(0);
  expect(result.psd.type).toBe("image/vnd.adobe.photoshop");
  expect(result.psd.size).toBeGreaterThan(0);
  expect(result.roundtripAipaint.type).toBe("application/x-aipaint");
  expect(result.roundtripAipaint.size).toBeGreaterThan(0);
  expect(result.finalDoc).toEqual({
    width: 12,
    height: 9,
    dpi: 192,
    activeLayerName: "top blue",
    layerNames: ["bottom red", "top blue"],
  });
  expect(result.bottom.bounds).toEqual({ x: 2, y: 1, w: 3, h: 2 });
  expect(result.bottom.pixel).toEqual([210, 40, 30, 255]);
  expect(result.top.bounds).toEqual({ x: 7, y: 4, w: 2, h: 3 });
  expect(result.top.pixel).toEqual([30, 80, 220, 255]);
});
