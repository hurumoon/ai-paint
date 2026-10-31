import { useEffect, useRef, useState } from "react";
import { ChatMessage, GuideShape } from "../types";
import { OMITTED_CHAT_IMAGE_TEXT } from "../core/chatHistory";
import { Button, IconButton } from "../ui/primitives";
import {
  IconChat,
  IconExternalLink,
  IconImage,
  IconSend,
  IconTrash,
} from "../ui/Icons";

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string;

  draft: string;
  setDraft: (v: string) => void;

  attachCanvasNext: boolean;
  setAttachCanvasNext: (v: boolean) => void;

  onSend: () => void;
  onClear: () => void;

  // assistant メッセージのガイドを再適用したい時のフック
  onApplyGuides?: (guides: GuideShape[]) => void;
  onClearGuides?: () => void;
  onApplyPalette?: (palette: string[]) => void;

  // 独立ウィンドウ
  detachable?: boolean;
  onDetachWindow?: () => void;

  // ヘッダーを出すか（独立ウィンドウ時は出さない）
  embedded?: boolean;

  hasApiKey: boolean;
}

export function ChatPanel(props: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const canSend =
    !props.isLoading &&
    props.hasApiKey &&
    (props.draft.trim().length > 0 || props.attachCanvasNext);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // 末尾までスクロール
    el.scrollTop = el.scrollHeight;
  }, [props.messages, props.isLoading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      if (canSend) {
        props.onSend();
      }
    }
  };

  return (
    <div
      className={`section chat-panel ${props.embedded === false ? "chat-panel-window" : ""}`}
    >
      {props.embedded !== false && (
        <div className="section-title">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconChat width={14} height={14} />
            AI チャット
          </span>
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {props.detachable && (
              <IconButton
                title="別ウィンドウで開く"
                onClick={props.onDetachWindow}
              >
                <IconExternalLink />
              </IconButton>
            )}
            <IconButton
              title="会話をクリア"
              onClick={props.onClear}
              disabled={props.isLoading}
            >
              <IconTrash />
            </IconButton>
          </div>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {props.messages.length === 0 && (
          <div className="chat-empty">
            キャンバスを見せたい時は「📎 キャンバス添付」をONにして送ってください。
            普段は普通にテキストで会話できます。
          </div>
        )}
        {props.messages.map((m) => (
          <div
            key={m.id}
            className={`chat-msg chat-msg-${m.role}`}
          >
            <div className="chat-msg-role">
              {m.role === "user" ? "あなた" : "Claude"}
            </div>
            {m.imagePreviewUrl && (
              <img
                src={m.imagePreviewUrl}
                alt="attached canvas"
                className="chat-msg-image"
              />
            )}
            {m.imageOmitted && (
              <div className="chat-msg-text">{OMITTED_CHAT_IMAGE_TEXT}</div>
            )}
            <div className="chat-msg-text">{m.text}</div>
            {m.role === "assistant" && (m.guides?.length || m.palette?.length) ? (
              <div className="chat-msg-actions">
                {m.guides && m.guides.length > 0 && props.onApplyGuides && (
                  <>
                    <button
                      className="btn ghost"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => props.onApplyGuides!(m.guides!)}
                      title="このメッセージのガイドをキャンバスに再表示"
                    >
                      補助線を再表示（{m.guides.length}）
                    </button>
                    {props.onClearGuides && (
                      <button
                        className="btn ghost"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={props.onClearGuides}
                        title="キャンバス上の補助線をクリア"
                      >
                        補助線をクリア
                      </button>
                    )}
                  </>
                )}
                {m.palette && m.palette.length > 0 && props.onApplyPalette && (
                  <button
                    className="btn ghost"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => props.onApplyPalette!(m.palette!)}
                    title="このパレットをパレット欄に再表示"
                  >
                    パレット再表示
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {props.isLoading && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-role">Claude</div>
            <div className="chat-msg-text chat-typing">考え中…</div>
          </div>
        )}
      </div>

      {props.error && <div className="ai-error">{props.error}</div>}

      <div className="chat-input">
        <label className="chat-attach-toggle" title="次の送信でキャンバス画像を添付。画像は直近1枚だけ保持・送信します">
          <input
            type="checkbox"
            checked={props.attachCanvasNext}
            onChange={(e) => props.setAttachCanvasNext(e.target.checked)}
          />
          <IconImage width={14} height={14} />
          <span>キャンバス添付</span>
        </label>
        <textarea
          ref={taRef}
          className="textarea chat-textarea"
          placeholder={
            props.hasApiKey
              ? "メッセージを入力（Enterで送信、Shift+Enterで改行）"
              : "設定画面で API キーを設定してください"
          }
          value={props.draft}
          onChange={(e) => props.setDraft(e.target.value)}
          onKeyDown={handleKey}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          rows={3}
          disabled={!props.hasApiKey}
        />
        <Button
          variant="primary"
          onClick={props.onSend}
          disabled={!canSend}
          title="送信"
        >
          <IconSend width={14} height={14} />
          {props.isLoading ? "送信中..." : "送信"}
        </Button>
      </div>
    </div>
  );
}
