import { useMemo } from "react";
import type { AppChromeModel } from "../components/AppChrome";
import { useAppMenuModel } from "./chrome/useAppMenuModel";
import { useAppTabsModel } from "./chrome/useAppTabsModel";
import { useAppToolbarModel } from "./chrome/useAppToolbarModel";
import { useAppToolOptionsModel } from "./chrome/useAppToolOptionsModel";
import type { UseAppChromeModelParams } from "./chrome/types";

export type { UseAppChromeModelParams } from "./chrome/types";

export function useAppChromeModel(
  params: UseAppChromeModelParams
): AppChromeModel {
  const menu = useAppMenuModel(params);
  const tabs = useAppTabsModel(params);
  const toolbar = useAppToolbarModel(params);
  const toolOptions = useAppToolOptionsModel(params);

  return useMemo<AppChromeModel>(
    () => ({
      menu,
      tabs,
      toolbar,
      toolOptions,
    }),
    [menu, tabs, toolbar, toolOptions]
  );
}
