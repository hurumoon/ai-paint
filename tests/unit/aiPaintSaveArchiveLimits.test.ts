import { describe, expect, it, vi } from "vitest";
import { AiPaintFileError } from "../../src/core/nativeFormatParts/errors";

const limit = vi.hoisted(() => ({ bytes: 64 }));

vi.mock("../../src/core/nativeFormatParts/validation", () => ({
  validateSavedV2ArchiveSize: (bytes: number) => {
    if (bytes > limit.bytes) throw new AiPaintFileError("アーカイブが小さい上限を超えました");
  },
}));

import { createAiPaintArchiveBuilder } from "../../src/core/nativeFormatParts/saveArchive";

describe("aipaint streaming archive size limit", () => {
  it("rejects a data chunk before retaining it", () => {
    const builder = createAiPaintArchiveBuilder();
    expect(() => builder.add("layers/layer-000001.png", new Uint8Array(128)))
      .toThrow(AiPaintFileError);
    builder.dispose();
  });

  it("also rejects central-directory output emitted by finish", () => {
    const builder = createAiPaintArchiveBuilder();
    builder.add("a.png", new Uint8Array());
    expect(() => builder.finish()).toThrow("小さい上限");
  });
});
