import { describe, expect, it } from "vitest";
import {
  areTabActionsLocked,
  isTabsLocked,
  tabSwitchBlockedReason,
} from "../../src/core/appTabLocks";

describe("appTabLocks", () => {
  it("locks tab selection while saving, dialogs are open, or chat is loading", () => {
    expect(
      isTabsLocked({
        savingFileName: null,
        anyDialogOpen: false,
        chatLoading: false,
      })
    ).toBe(false);

    expect(
      isTabsLocked({
        savingFileName: "work.aipaint",
        anyDialogOpen: false,
        chatLoading: false,
      })
    ).toBe(true);

    expect(
      isTabsLocked({
        savingFileName: null,
        anyDialogOpen: true,
        chatLoading: false,
      })
    ).toBe(true);

    expect(
      isTabsLocked({
        savingFileName: null,
        anyDialogOpen: false,
        chatLoading: true,
      })
    ).toBe(true);

    expect(
      isTabsLocked({
        savingFileName: null,
        anyDialogOpen: false,
        chatLoading: false,
      })
    ).toBe(false);
  });

  it("keeps blocked reason priority stable", () => {
    expect(
      tabSwitchBlockedReason({
        saving: true,
        painting: true,
        anyDialogOpen: true,
        chatLoading: true,
      })
    ).toBe(tabSwitchBlockedReason({
      saving: true,
      painting: false,
      anyDialogOpen: false,
      chatLoading: false,
    }));

    expect(
      tabSwitchBlockedReason({
        saving: false,
        painting: true,
        anyDialogOpen: true,
        chatLoading: true,
      })
    ).toBe(tabSwitchBlockedReason({
      saving: false,
      painting: true,
      anyDialogOpen: false,
      chatLoading: false,
    }));

    expect(
      tabSwitchBlockedReason({
        saving: false,
        painting: false,
        anyDialogOpen: false,
        chatLoading: false,
      })
    ).toBeNull();
  });

  it("allows tab selection but locks tab actions while only AI is loading", () => {
    const idleTabs = {
      savingFileName: null,
      anyDialogOpen: false,
      chatLoading: false,
    };

    expect(isTabsLocked(idleTabs)).toBe(false);
    expect(areTabActionsLocked({ ...idleTabs, aiLoading: true })).toBe(true);
    expect(areTabActionsLocked({ ...idleTabs, aiLoading: false })).toBe(false);
    expect(
      tabSwitchBlockedReason({
        saving: false,
        painting: false,
        anyDialogOpen: false,
        chatLoading: false,
      })
    ).toBeNull();
  });
});
