import { Fragment } from "react";
import type { RightSectionId } from "../core/panelLayout";
import { renderPanelSection } from "./panels/panelRegistry";
import type { AppPanelsProps, PanelRenderContext } from "./panels/types";

export function AppPanels({
  layout,
  panelModel,
}: AppPanelsProps) {
  const renderContext: PanelRenderContext = panelModel;
  const renderSection = (id: RightSectionId) => (
    <Fragment key={id}>{renderPanelSection(id, renderContext)}</Fragment>
  );

  const leftSections = layout.leftSections.filter(
    (id) => !(id === "chat" && panelModel.chatState.chatDetached)
  );
  const rightSections = layout.rightSections.filter(
    (id) => !(id === "chat" && panelModel.chatState.chatDetached)
  );

  return (
    <>
      {leftSections.length > 0 && (
        <div className="left-panel">
          {leftSections.map((id) => renderSection(id))}
        </div>
      )}

      {rightSections.length > 0 && (
        <div className="right-panel">
          {rightSections.map((id) => renderSection(id))}
        </div>
      )}
    </>
  );
}
