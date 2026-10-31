import { Button, pushToast } from "../ui/primitives";
import appLicense from "../../LICENSE?raw";
import thirdPartyNotices from "../../THIRD_PARTY_NOTICES.txt?raw";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: Props) {
  if (!open) return null;

  const hash = __APP_GIT_HASH__;
  const hashFull = __APP_GIT_HASH_FULL__;

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(hashFull);
      pushToast("ハッシュIDをコピーしました", "success");
    } catch {
      pushToast("コピーに失敗しました", "error");
    }
  };

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="popover"
        role="dialog"
        aria-modal="true"
        aria-label="AI Paintについて"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>About</strong>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "center",
            padding: "8px 0",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600 }}>AI Paint</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                minWidth: 80,
              }}
            >
              ハッシュID
            </span>
            <code
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                background: "var(--bg-elev)",
                padding: "2px 6px",
                borderRadius: 4,
                flex: 1,
                wordBreak: "break-all",
              }}
              title={hashFull}
            >
              {hash}
            </code>
            <button
              className="btn ghost"
              style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={copyHash}
              title="フルハッシュをコピー"
            >
              コピー
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                minWidth: 80,
              }}
            >
              作者
            </span>
            <span style={{ fontSize: 12 }}>hurumoon</span>
          </div>
          <div style={{ fontSize: 12 }}>MIT License · © 2026 hurumoon</div>
        </div>

        <details>
          <summary style={{ cursor: "pointer", fontSize: 12 }}>
            本体のライセンス
          </summary>
          <LicenseText text={appLicense} />
        </details>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12 }}>
            第三者ライセンスとソースの入手方法
          </summary>
          <LicenseText text={thirdPartyNotices} />
        </details>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </>
  );
}

function LicenseText({ text }: { text: string }) {
  return (
    <pre
      tabIndex={0}
      style={{
        maxHeight: "35vh",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontSize: 11,
        lineHeight: 1.5,
        padding: 8,
        background: "var(--bg-elev)",
        userSelect: "text",
      }}
    >
      {text}
    </pre>
  );
}
