import { describe, expect, it } from "vitest";
import { createSavedProjectMetadataPatch } from "../../src/core/saveVersionGuard";

describe("save version guard", () => {
  it("marks the saved version when the document version did not change", () => {
    expect(
      createSavedProjectMetadataPatch({
        fileName: "work.aipaint",
        path: "C:\\work\\work.aipaint",
        historyVersionAtSave: 4,
        documentVersionAtSave: 9,
        currentHistoryVersion: 4,
        currentDocumentVersion: 9,
      })
    ).toEqual({
      hasUnsavedChangesAfterSave: false,
      patch: {
        fileName: "work.aipaint",
        filePath: "C:\\work\\work.aipaint",
        lastSavedVersion: 4,
        lastSavedDocumentVersion: 9,
      },
    });
  });

  it("keeps the document dirty when the history version changed during save", () => {
    expect(
      createSavedProjectMetadataPatch({
        fileName: "work.aipaint",
        path: undefined,
        historyVersionAtSave: 4,
        documentVersionAtSave: 9,
        currentHistoryVersion: 5,
        currentDocumentVersion: 10,
      })
    ).toEqual({
      hasUnsavedChangesAfterSave: true,
      patch: {
        fileName: "work.aipaint",
        filePath: null,
      },
    });
  });

  it("keeps the document dirty when only the document version changed during save", () => {
    expect(
      createSavedProjectMetadataPatch({
        fileName: "work.aipaint",
        path: undefined,
        historyVersionAtSave: 4,
        documentVersionAtSave: 9,
        currentHistoryVersion: 4,
        currentDocumentVersion: 10,
      }).hasUnsavedChangesAfterSave
    ).toBe(true);
  });
});
