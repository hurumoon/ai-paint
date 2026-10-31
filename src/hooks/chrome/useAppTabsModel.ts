import { useMemo } from "react";
import type { AppChromeTabsModel } from "../../components/AppChrome";
import type { UseAppChromeModelParams } from "./types";

export function useAppTabsModel({
  tabs: tabState,
  actions,
}: UseAppChromeModelParams): AppChromeTabsModel {
  const { tabs, activeTabId } = tabState;
  const { tabActions } = actions;
  const {
    tabIsDirty,
    tabsLocked,
    tabActionsLocked,
    handleSelectTab,
    handleCloseTab,
    handleAddBlankTab,
    handleReorderTab,
  } = tabActions;

  return useMemo<AppChromeTabsModel>(
    () => ({
      tabs,
      activeTabId,
      tabIsDirty,
      tabsLocked,
      tabActionsLocked,
      onSelectTab: handleSelectTab,
      onCloseTab: handleCloseTab,
      onAddBlankTab: handleAddBlankTab,
      onReorderTab: handleReorderTab,
    }),
    [
      activeTabId,
      handleAddBlankTab,
      handleCloseTab,
      handleReorderTab,
      handleSelectTab,
      tabIsDirty,
      tabActionsLocked,
      tabs,
      tabsLocked,
    ]
  );
}
