import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessage } from "../types";
import { ChatPanel } from "./ChatPanel";
import {
  emitChatAction,
  listenChatState,
  requestChatState,
} from "../core/chatWindow";
import { useTheme } from "../hooks/useTheme";

// 別ウィンドウ専用のチャットアプリ。
// メインウィンドウから state スナップショットを受け取って表示し、
// ユーザー入力イベントはメインに送り返す。実 API 呼び出しはメインが行う。
export function ChatWindowApp() {
  // メインと同じ localStorage を読むので初期テーマは揃う。
  // メインで切り替えた場合は storage イベントで追従する。
  useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachCanvas, setAttachCanvas] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  // メイン由来の state 更新で setDraft/setAttachCanvas を呼ぶ際は
  // 「自分が入力した変更」と区別したいので、フラグで echo を抑制する。
  const suppressEmitRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    const ready = listenChatState((payload) => {
      if (canceled || !payload) return;
      suppressEmitRef.current = true;
      if (Array.isArray(payload.messages)) setMessages(payload.messages);
      if (typeof payload.draft === "string") setDraft(payload.draft);
      if (typeof payload.attachCanvas === "boolean")
        setAttachCanvas(payload.attachCanvas);
      if (typeof payload.isLoading === "boolean") setIsLoading(payload.isLoading);
      if (typeof payload.error === "string") setError(payload.error);
      if (typeof payload.hasApiKey === "boolean") setHasApiKey(payload.hasApiKey);
      // setState は同期的にバッチされるので、フラグは microtask 後に解除すれば
      // 反映完了後の useEffect 連鎖をスキップできる。
      queueMicrotask(() => {
        suppressEmitRef.current = false;
      });
    }).catch((err) => {
      console.warn("listenChatState failed:", err);
      return null;
    });
    // 初期 state を要求
    requestChatState();
    return () => {
      canceled = true;
      ready.then((un) => {
        if (un) un();
      });
    };
  }, []);

  // ユーザー入力をメインへ転送（メイン由来の state 更新時は emit しない）
  const handleDraftChange = useCallback((v: string) => {
    setDraft(v);
    if (!suppressEmitRef.current) emitChatAction("draft", { draft: v });
  }, []);

  const handleAttachChange = useCallback((v: boolean) => {
    setAttachCanvas(v);
    if (!suppressEmitRef.current) emitChatAction("attachCanvas", { attachCanvas: v });
  }, []);

  // 送信時はメインのstateにまだ届いていない可能性があるので、最新 draft をペイロードに乗せる
  const handleSend = useCallback(() => {
    emitChatAction("send", { draft });
  }, [draft]);

  return (
    <div className="chat-window-root">
      <ChatPanel
        embedded={false}
        messages={messages}
        isLoading={isLoading}
        error={error}
        draft={draft}
        setDraft={handleDraftChange}
        attachCanvasNext={attachCanvas}
        setAttachCanvasNext={handleAttachChange}
        onSend={handleSend}
        onClear={() => emitChatAction("clear")}
        onApplyGuides={(g) => emitChatAction("applyGuides", { guides: g })}
        onClearGuides={() => emitChatAction("clearGuides")}
        onApplyPalette={(p) => emitChatAction("applyPalette", { palette: p })}
        hasApiKey={hasApiKey}
      />
    </div>
  );
}
