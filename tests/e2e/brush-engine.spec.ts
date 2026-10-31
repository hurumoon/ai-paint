import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("brushEngine draws and erases expected canvas regions", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { beginStroke, continueStroke } = await import("/src/core/brushEngine.ts");

    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d context was not available");
    }

    const round = {
      kind: "round",
      size: 10,
      opacity: 1,
      color: "#000000",
      pressureSize: 0,
      pressureOpacity: 0,
    } as const;
    const start = { x: 10, y: 20, pressure: 0.5 };
    const end = { x: 50, y: 20, pressure: 0.5 };
    beginStroke(ctx, start, round);
    continueStroke(ctx, start, end, round);

    const stroke = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let minX = canvas.width;
    let maxX = 0;
    let minY = canvas.height;
    let maxY = 0;
    for (let i = 0; i < stroke.length; i += 4) {
      const alpha = stroke[i + 3];
      if (alpha === 0) continue;
      const pixel = i / 4;
      const x = pixel % canvas.width;
      const y = Math.floor(pixel / canvas.width);
      painted += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    beginStroke(ctx, { x: 40, y: 20, pressure: 0.5 }, {
      kind: "eraser-soft",
      size: 30,
      opacity: 1,
      color: "#000000",
    });
    const erased = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const centerIndex = (20 * canvas.width + 40) * 4 + 3;
    const cornerIndex = 3;

    const originalRandom = Math.random;
    Math.random = () => 0.25;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      beginStroke(ctx, { x: 20, y: 20, pressure: 0.5 }, {
        kind: "spray",
        size: 20,
        opacity: 1,
        color: "#111111",
      });
      beginStroke(ctx, { x: 60, y: 20, pressure: 0.5 }, {
        kind: "sparkle",
        size: 24,
        opacity: 1,
        color: "#222222",
      });
    } finally {
      Math.random = originalRandom;
    }
    const randomSmoke = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let randomPainted = 0;
    for (let i = 3; i < randomSmoke.length; i += 4) {
      if (randomSmoke[i] > 0) {
        randomPainted += 1;
      }
    }

    return {
      painted,
      minX,
      maxX,
      minY,
      maxY,
      centerAlphaAfterSoftErase: erased.data[centerIndex],
      cornerAlphaAfterSoftErase: erased.data[cornerIndex],
      randomPainted,
    };
  });

  expect(result.painted).toBeGreaterThan(350);
  expect(result.minX).toBeLessThanOrEqual(5);
  expect(result.maxX).toBeGreaterThanOrEqual(54);
  expect(result.minY).toBeGreaterThanOrEqual(14);
  expect(result.maxY).toBeLessThanOrEqual(26);
  expect(result.centerAlphaAfterSoftErase).toBeLessThan(220);
  expect(result.cornerAlphaAfterSoftErase).toBe(255);
  expect(result.randomPainted).toBeGreaterThan(10);
});

test("every advertised brush stamp, including custom, produces pixels", async ({ page }) => {
  await page.goto("/");

  const results = await page.evaluate(async () => {
    const { beginStroke } = await import("/src/core/brushEngine.ts");
    const kinds = [
      "round",
      "pencil",
      "marker",
      "airbrush",
      "calligraphy",
      "pen",
      "watercolor",
      "charcoal",
      "spray",
      "dotted",
      "crayon",
      "oil",
      "pastel",
      "fountainPen",
      "chalk",
      "scatter",
      "gPen",
      "maruPen",
      "highlighter",
      "neon",
      "sparkle",
    ] as const;
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 8;
    const sourceContext = source.getContext("2d");
    if (!sourceContext) throw new Error("custom brush source context unavailable");
    sourceContext.fillStyle = "#ffffff";
    sourceContext.fillRect(1, 1, 6, 6);
    const customBitmap = await createImageBitmap(source);
    const output: Array<{ kind: string; painted: number }> = [];
    const originalRandom = Math.random;
    Math.random = () => 0.25;
    try {
      for (const kind of [...kinds, "custom"] as const) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        if (!context) throw new Error(`context unavailable for ${kind}`);
        beginStroke(context, { x: 32, y: 32, pressure: 0.75 }, {
          kind,
          size: 24,
          opacity: 0.8,
          color: "#336699",
          pressureSize: 0,
          pressureOpacity: 0,
          custom:
            kind === "custom"
              ? { bitmap: customBitmap, tint: true }
              : undefined,
        });
        const pixels = context.getImageData(0, 0, 64, 64).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 0) painted += 1;
        }
        output.push({ kind, painted });
      }
    } finally {
      Math.random = originalRandom;
      customBitmap.close();
    }
    return output;
  });

  expect(results.map((result) => result.kind)).toHaveLength(22);
  for (const result of results) {
    expect(result.painted, `${result.kind} should paint pixels`).toBeGreaterThan(0);
  }
});
