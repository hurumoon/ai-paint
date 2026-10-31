import { describe, expect, it } from "vitest";
import {
  checkFileActionGate,
  type FileActionGateState,
} from "../../src/core/fileActionGate";

const idleState: FileActionGateState = {
  loading: false,
  saving: false,
  painting: false,
  autoBackupBusy: false,
  anyDialogOpen: false,
  hasActiveTab: true,
};

describe("fileActionGate", () => {
  it("allows file operations when no conflicting operation is active", () => {
    expect(checkFileActionGate("open-file", idleState)).toEqual({ allowed: true });
    expect(checkFileActionGate("open-image", idleState)).toEqual({ allowed: true });
    expect(checkFileActionGate("save", idleState)).toEqual({ allowed: true });
  });

  it("blocks save and additional opens while a file is loading", () => {
    const loadingState = { ...idleState, loading: true };

    expect(checkFileActionGate("save", loadingState)).toMatchObject({
      allowed: false,
      reason: "loading",
    });
    expect(checkFileActionGate("open-file", loadingState)).toMatchObject({
      allowed: false,
      reason: "loading",
    });
    expect(checkFileActionGate("open-image", loadingState)).toMatchObject({
      allowed: false,
      reason: "loading",
    });
  });

  it("keeps the existing open and save conflicts in the shared gate", () => {
    expect(
      checkFileActionGate("open-file", { ...idleState, saving: true }),
    ).toMatchObject({ allowed: false, reason: "saving" });
    expect(
      checkFileActionGate("open-file", { ...idleState, anyDialogOpen: true }),
    ).toMatchObject({ allowed: false, reason: "dialog" });
    expect(
      checkFileActionGate("save", { ...idleState, painting: true }),
    ).toMatchObject({ allowed: false, reason: "painting" });
    expect(
      checkFileActionGate("save", { ...idleState, autoBackupBusy: true }),
    ).toMatchObject({ allowed: false, reason: "auto-backup" });
  });

  it("blocks file and image opens while painting", () => {
    const paintingState = { ...idleState, painting: true };

    expect(checkFileActionGate("open-file", paintingState)).toMatchObject({
      allowed: false,
      reason: "painting",
    });
    expect(checkFileActionGate("open-image", paintingState)).toMatchObject({
      allowed: false,
      reason: "painting",
    });
  });
});
