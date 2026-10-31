import type { ShortcutHandlers, TabShortcutOptions } from "./types";

export function createTabShortcutHandlers({
  activeTabId,
  handleCloseTab,
}: TabShortcutOptions): ShortcutHandlers {
  return {
    "tab.close": () => {
      if (activeTabId) void handleCloseTab(activeTabId);
    },
  };
}
