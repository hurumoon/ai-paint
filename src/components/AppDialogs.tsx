import type { AppDialogsModel } from "./dialogs/types";
import { AppDocumentDialogs } from "./dialogs/AppDocumentDialogs";
import { AppSettingsDialogs } from "./dialogs/AppSettingsDialogs";
import { AppUtilityDialogs } from "./dialogs/AppUtilityDialogs";

type AppDialogsProps = AppDialogsModel;

export function AppDialogs({
  documentState,
  visibility,
  settings,
  actions,
}: AppDialogsProps) {
  return (
    <>
      <AppSettingsDialogs
        documentState={documentState}
        visibility={visibility}
        settings={settings}
        actions={actions}
      />
      <AppDocumentDialogs
        documentState={documentState}
        visibility={visibility}
        settings={settings}
        actions={actions}
      />
      <AppUtilityDialogs
        visibility={visibility}
        actions={actions}
      />
    </>
  );
}
