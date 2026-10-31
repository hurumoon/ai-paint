import { describe, expect, it } from "vitest";
import {
  OPEN_FILE_ACCEPT,
  OPEN_IMAGE_FILTERS,
  isSupportedOpenFilePath,
} from "../../src/core/fileFormats";

describe("file format filters", () => {
  it("exposes only supported open formats", () => {
    expect(OPEN_IMAGE_FILTERS[0].extensions).toEqual([
      "aipaint",
      "psd",
      "png",
      "jpg",
      "jpeg",
      "webp",
    ]);
    expect(OPEN_FILE_ACCEPT).toBe(".aipaint,.psd,.png,.jpg,.jpeg,.webp");
  });

  it("rejects unsupported image-like extensions", () => {
    expect(isSupportedOpenFilePath("work.aipaint")).toBe(true);
    expect(isSupportedOpenFilePath("photo.PNG")).toBe(true);
    expect(isSupportedOpenFilePath("photo.jpeg")).toBe(true);
    expect(isSupportedOpenFilePath("photo.webp")).toBe(true);
    expect(isSupportedOpenFilePath("vector.svg")).toBe(false);
    expect(isSupportedOpenFilePath("animation.gif")).toBe(false);
    expect(isSupportedOpenFilePath("bitmap.bmp")).toBe(false);
    expect(isSupportedOpenFilePath("photo.avif")).toBe(false);
  });
});
