import type { AppPanelsViewState } from "./types";
import { Slider } from "../../ui/primitives";

interface ViewPanelSectionProps {
  viewState: AppPanelsViewState;
}

export function ViewPanelSection({ viewState }: ViewPanelSectionProps) {
  return (
    <div className="section">
      <div className="section-title">
        表示
        <button
          className="btn ghost"
          style={{ padding: "2px 8px", fontSize: 10 }}
          onClick={() => {
            viewState.setZoom(1);
            viewState.setPan({ x: 0, y: 0 });
            viewState.setRotation(0);
          }}
          title="ズーム/パン/回転をリセット"
        >
          リセット
        </button>
      </div>
      <Slider
        label="ズーム"
        value={Math.round(viewState.zoom * 100)}
        min={10}
        max={400}
        onChange={(v) => viewState.setZoom(v / 100)}
        format={(v) => `${v}%`}
      />
      <Slider
        label="回転"
        value={viewState.rotation}
        min={0}
        max={359}
        onChange={viewState.setRotation}
        format={(v) => `${v}°`}
      />
    </div>
  );
}
