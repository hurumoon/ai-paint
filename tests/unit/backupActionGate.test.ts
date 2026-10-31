import { describe, expect, it } from "vitest";
import {
  canStartAutoBackup,
  checkBackupActionGate,
  type BackupActionGateState,
} from "../../src/core/backupActionGate";

const idle: BackupActionGateState = {
  hasActiveTab: true,
  saving: false,
  fileLoading: false,
  painting: false,
  aiLoading: false,
  chatLoading: false,
  operationBusy: false,
};

describe("backup action gate", () => {
  it("starts auto backup only when every conflicting operation is idle", () => {
    expect(canStartAutoBackup(idle)).toBe(true);
    for (const patch of [
      { saving: true },
      { fileLoading: true },
      { painting: true },
      { aiLoading: true },
      { chatLoading: true },
    ]) {
      expect(canStartAutoBackup({ ...idle, ...patch })).toBe(false);
    }
  });

  it("blocks current-tab restore for every operation that can mutate its document", () => {
    for (const patch of [
      { saving: true },
      { fileLoading: true },
      { painting: true },
      { aiLoading: true },
      { operationBusy: true },
    ]) {
      expect(
        checkBackupActionGate("restore-current", { ...idle, ...patch }).allowed
      ).toBe(false);
    }
  });

  it("blocks new-tab restore while tab-store-changing work is forbidden", () => {
    for (const patch of [
      { saving: true },
      { fileLoading: true },
      { painting: true },
      { aiLoading: true },
      { chatLoading: true },
      { operationBusy: true },
    ]) {
      expect(
        checkBackupActionGate("restore-new-tab", { ...idle, ...patch }).allowed
      ).toBe(false);
    }
  });

  it("blocks delete and cleanup while the runner is active", () => {
    expect(
      checkBackupActionGate("delete", {
        ...idle,
        operationBusy: true,
      }).allowed
    ).toBe(false);
    expect(checkBackupActionGate("delete", idle)).toEqual({ allowed: true });
  });
});
