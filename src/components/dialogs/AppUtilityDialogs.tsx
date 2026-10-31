import { lazy } from "react";
import type {
  AppDialogActions,
  AppDialogVisibility,
} from "./types";

const AboutDialog = lazy(() =>
  import("../AboutDialog").then((module) => ({ default: module.AboutDialog }))
);
const NewCanvasDialog = lazy(() =>
  import("../NewCanvasDialog").then((module) => ({ default: module.NewCanvasDialog }))
);

type AppUtilityDialogsVisibility = Pick<
  AppDialogVisibility,
  "showAboutDialog" | "showNewCanvasDialog"
>;

type AppUtilityDialogsActions = Pick<
  AppDialogActions,
  | "onCloseAboutDialog"
  | "onCloseNewCanvasDialog"
  | "onNewCanvasConfirm"
>;

interface AppUtilityDialogsProps {
  visibility: AppUtilityDialogsVisibility;
  actions: AppUtilityDialogsActions;
}

export function AppUtilityDialogs({
  visibility,
  actions,
}: AppUtilityDialogsProps) {
  return (
    <>
      <AboutDialog
        open={visibility.showAboutDialog}
        onClose={actions.onCloseAboutDialog}
      />
      <NewCanvasDialog
        open={visibility.showNewCanvasDialog}
        onClose={actions.onCloseNewCanvasDialog}
        onConfirm={actions.onNewCanvasConfirm}
      />
    </>
  );
}
