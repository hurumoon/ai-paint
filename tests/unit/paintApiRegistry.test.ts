import { describe, expect, it, vi } from "vitest";
import {
  createPaintApi,
  PaintApi,
  type PaintApiContext,
} from "../../src/core/paintApi";

function context(overrides: Partial<PaintApiContext> = {}): PaintApiContext {
  return {
    getDocument: () => null,
    getHistory: () => null,
    getTimelapse: () => null,
    getSelection: () => ({ kind: "none" }),
    setSelection: () => undefined,
    ...overrides,
  };
}

describe("PaintApi registry", () => {
  it("discovers immutable definitions and executes a validated handler", async () => {
    const api = new PaintApi(context());
    const handler = vi.fn(({ count }: Record<string, unknown>) => ({ doubled: (count as number) * 2 }));
    api.register({
      name: "test.double",
      description: "double",
      parameters: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1, maximum: 10 } },
        required: ["count"],
        additionalProperties: false,
      },
      mutates: false,
    }, handler);

    const definitions = api.list();
    definitions[0].description = "changed";
    expect(api.list()[0].description).toBe("double");
    await expect(api.execute("test.double", { count: 4 })).resolves.toEqual({
      ok: true,
      value: { doubled: 8 },
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects non-finite, nested invalid, unknown and extra arguments without running", async () => {
    const api = new PaintApi(context());
    const handler = vi.fn();
    api.register({
      name: "test.points",
      description: "points",
      parameters: {
        type: "object",
        properties: {
          points: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: { x: { type: "number" }, mode: { type: "string", enum: ["a", "b"] } },
              required: ["x", "mode"],
              additionalProperties: false,
            },
          },
        },
        required: ["points"],
        additionalProperties: false,
      },
      mutates: false,
    }, handler);

    const invalid = await api.execute("test.points", {
      points: [{ x: Number.POSITIVE_INFINITY, mode: "c", extra: true }],
      unexpected: true,
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    if (!invalid.ok) {
      expect(invalid.error.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "$.points[0].x" }),
        expect.objectContaining({ path: "$.points[0].mode" }),
        expect.objectContaining({ path: "$.points[0].extra" }),
        expect.objectContaining({ path: "$.unexpected" }),
      ]));
    }
    expect(handler).not.toHaveBeenCalled();
    await expect(api.execute("test.missing", {})).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("blocks mutations while busy and honors cancellation before handler entry", async () => {
    const handler = vi.fn();
    const api = new PaintApi(context({ isBusy: () => true }));
    api.register({ name: "test.write", description: "write", parameters: { type: "object" }, mutates: true }, handler);
    await expect(api.execute("test.write", {})).resolves.toMatchObject({ ok: false, error: { code: "BUSY" } });

    const idleApi = new PaintApi(context());
    idleApi.register({ name: "test.write", description: "write", parameters: { type: "object" }, mutates: true }, handler);
    const controller = new AbortController();
    controller.abort();
    await expect(idleApi.execute("test.write", {}, { signal: controller.signal })).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("serializes mutating handlers so History operations cannot overlap", async () => {
    const api = new PaintApi(context());
    const order: string[] = [];
    let releaseFirst = (): void => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    api.register({ name: "test.serial", description: "serial", parameters: { type: "object" }, mutates: true }, async (args) => {
      order.push(`start-${args.id}`);
      if (args.id === 1) await firstGate;
      order.push(`end-${args.id}`);
      return args.id;
    });

    const first = api.execute("test.serial", { id: 1 });
    const second = api.execute("test.serial", { id: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start-1"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("ships a catalog with reliable observation and mutation flags", async () => {
    const api = createPaintApi(context());
    const byName = new Map(api.list().map((definition) => [definition.name, definition]));
    expect(byName.get("document.get_image")?.mutates).toBe(false);
    expect(byName.get("document.get_state")?.mutates).toBe(false);
    expect(byName.get("drawing.stroke")?.mutates).toBe(true);
    expect(byName.get("selection.transform")?.mutates).toBe(true);
    expect(byName.get("layer.merge_down")?.mutates).toBe(true);
    expect(byName.get("canvas.resize")?.mutates).toBe(true);
    expect(api.list().length).toBeGreaterThanOrEqual(30);

    await expect(api.execute("document.get_state", {})).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_DOCUMENT" },
    });
  });

  it("holds the shared painting lock across asynchronous work and releases it after failure", async () => {
    let busy = false;
    const api = new PaintApi(context({
      isBusy: () => busy,
      beginMutation: () => { busy = true; return () => { busy = false; }; },
    }));
    let finish = (): void => undefined;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    api.register({ name: "test.async", description: "async", parameters: { type: "object" }, mutates: true }, async () => {
      await gate;
      throw new Error("worker failed");
    });
    const task = api.execute("test.async", {});
    await Promise.resolve();
    expect(busy).toBe(true);
    finish();
    await expect(task).resolves.toMatchObject({ ok: false, error: { code: "EXECUTION_FAILED" } });
    expect(busy).toBe(false);
  });
});
