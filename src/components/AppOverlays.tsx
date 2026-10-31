import { IconUpload } from "../ui/Icons";

interface AppLoadingOverlayProps {
  label: string;
  subLabel?: string;
  busy?: boolean;
  progress?: number;
}

export function AppLoadingOverlay({
  label,
  subLabel,
  busy = false,
  progress,
}: AppLoadingOverlayProps) {
  const progressValue =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : null;

  return (
    <div
      className="loading-overlay"
      role="status"
      aria-live="polite"
      aria-busy={busy || undefined}
    >
      <div className="loading-overlay-box">
        <div className="loading-spinner" />
        <div className="loading-overlay-text">{label}</div>
        {subLabel && <div className="loading-overlay-sub">{subLabel}</div>}
        {progressValue !== null && (
          <div className="loading-overlay-progress" aria-hidden="true">
            <div className="loading-overlay-progress-track">
              <div
                className="loading-overlay-progress-fill"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="loading-overlay-progress-percent">{progressValue}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppDropOverlay() {
  return (
    <div className="drop-overlay">
      <div className="drop-overlay-box">
        <IconUpload />
        <div className="drop-overlay-text">画像をドロップして読み込み</div>
        <div className="drop-overlay-sub">PNG / JPEG / WebP / .aipaint / .psd 対応</div>
      </div>
    </div>
  );
}
