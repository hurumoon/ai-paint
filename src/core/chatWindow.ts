import { useEffect, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo, listen } from "@tauri-apps/api/event";
import { ChatMessage, GuideShape } from "../types";
import { isTauri } from "../utils/saveFile";
import type { ChatActionPayload, ChatActionType } from "./chatActions";

// ===== イベント名 =====
// メイン→チャット: ai-paint://chat/state
// チャット→メイン: ai-paint://chat/action
const STATE_EVENT = "ai-paint://chat/state";
const ACTION_EVENT = "ai-paint://chat/action";
const REQUEST_STATE_EVENT = "ai-paint://chat/request-state";

const CHAT_WINDOW_LABEL = "chat";
const MAIN_WINDOW_LABEL = "main";

// ===== ウィンドウ起動 =====
export async function openChatWindow(): Promise<void> {
  // 既に存在すればフォーカスのみ
  const existing = await WebviewWindow.getByLabel(CHAT_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.setFocus();
    } catch {
      // フォーカスに失敗しても既存ウィンドウは再作成しない。
    }
    return;
  }
  const win = new WebviewWindow(CHAT_WINDOW_LABEL, {
    url: "/chat.html",
    title: "AI Paint — チャット",
    width: 480,
    height: 720,
    minWidth: 360,
    minHeight: 400,
    resizable: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(e));
  });
}

// ===== 共通ペイロード =====
export interface ChatStatePayload {
  messages?: ChatMessage[];
  draft?: string;
  attachCanvas?: boolean;
  isLoading?: boolean;
  error?: string;
  hasApiKey?: boolean;
}


// ===== チャットウィンドウ側ヘルパ =====
export async function emitChatAction(
  type: ChatActionType,
  data: Omit<ChatActionPayload, "type"> = {}
): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW_LABEL, ACTION_EVENT, { type, ...data });
  } catch {
    // メインがいない（dev単独起動等）でも壊さない
  }
}

export async function listenChatState(
  cb: (payload: ChatStatePayload) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => undefined;
  }
  const un = await listen<ChatStatePayload>(STATE_EVENT, (e) => {
    cb(e.payload);
  });
  return un;
}

export async function requestChatState(): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW_LABEL, REQUEST_STATE_EVENT, {});
  } catch {
    // メインがいない（dev単独起動等）でも壊さない。
  }
}

// ===== 安全な useListen ヘルパ =====
// 初期化途中の cleanup でも確実に unlisten するため、Promise を介して解決を待つ。
function useTauriListen<T>(
  enabled: boolean,
  event: string,
  handler: (payload: T) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    if (!isTauri()) {
      return;
    }
    let canceled = false;
    const ready = listen<T>(event, (e) => {
      if (!canceled) handlerRef.current(e.payload);
    }).catch((err) => {
      if (isTauri()) {
        console.warn(`listen(${event}) failed:`, err);
      }
      return null;
    });
    return () => {
      canceled = true;
      ready.then((un) => {
        if (un) un();
      });
    };
  }, [enabled, event]);
}

// ===== メインウィンドウ側のブリッジフック =====
interface BridgeProps {
  isHost: boolean;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  draft: string;
  setDraft: (v: string) => void;
  attachCanvas: boolean;
  setAttachCanvas: (v: boolean) => void;
  isLoading: boolean;
  error: string;
  hasApiKey: boolean;
  detached: boolean;
  setDetached: (v: boolean) => void;
  // チャットウィンドウから "send" が来た場合は、その時点での draft が
  // メイン側 state にまだ反映されていない可能性があるため、第1引数で
  // 最新 draft を直接受け取れるようにする。メイン側から内部的に呼ぶ
  // 場合は省略（その場合は state にある最新 draft をそのまま使う）。
  onSend: (overrideDraft?: string) => void;
  onClear: () => void;
  onApplyGuides: (g: GuideShape[]) => void;
  onClearGuides: () => void;
  onApplyPalette: (p: string[]) => void;
}

export function useChatBridge(props: BridgeProps) {
  const ref = useRef(props);
  ref.current = props;

  // チャットウィンドウからのアクション受信
  useTauriListen<ChatActionPayload>(props.isHost, ACTION_EVENT, (p) => {
    switch (p.type) {
      case "send":
        // 送信直前に draft が運ばれてきたら、それで上書きしてから送信する（古い state を使わない）
        if (typeof p.draft === "string") ref.current.setDraft(p.draft);
        // setDraft は次レンダで反映されるので、send 本体には最新値を直接渡す経路にする
        ref.current.onSend(p.draft);
        break;
      case "clear":
        ref.current.onClear();
        break;
      case "draft":
        if (typeof p.draft === "string") ref.current.setDraft(p.draft);
        break;
      case "attachCanvas":
        if (typeof p.attachCanvas === "boolean")
          ref.current.setAttachCanvas(p.attachCanvas);
        break;
      case "applyGuides":
        if (Array.isArray(p.guides)) ref.current.onApplyGuides(p.guides);
        break;
      case "clearGuides":
        ref.current.onClearGuides();
        break;
      case "applyPalette":
        if (Array.isArray(p.palette)) ref.current.onApplyPalette(p.palette);
        break;
    }
  });

  // チャットウィンドウからの初期 state 要求
  useTauriListen(props.isHost, REQUEST_STATE_EVENT, () => {
    pushFullState(ref.current);
  });

  // 起動時にすでにチャットウィンドウが開いていれば一度プッシュ
  useEffect(() => {
    if (!props.isHost) return;
    let canceled = false;
    (async () => {
      try {
        const existing = await WebviewWindow.getByLabel(CHAT_WINDOW_LABEL);
        if (existing && !canceled) await pushFullState(ref.current);
      } catch {
        // Tauri未利用環境では初回同期をスキップする。
      }
    })();
    return () => {
      canceled = true;
    };
  }, [props.isHost]);

  // state が変わるたびチャットウィンドウへ反映（label限定 emitTo）
  useEffect(() => {
    if (!props.isHost) return;
    pushFullState(ref.current);
  }, [
    props.isHost,
    props.messages,
    props.draft,
    props.attachCanvas,
    props.isLoading,
    props.error,
    props.hasApiKey,
  ]);

  // チャットウィンドウが閉じられた検知 → detached=false
  useEffect(() => {
    if (!props.isHost) return;
    if (!props.detached) return;
    let canceled = false;
    const ready = (async () => {
      const win = await WebviewWindow.getByLabel(CHAT_WINDOW_LABEL);
      if (!win) return null;
      return await win.onCloseRequested(() => {
        if (!canceled) ref.current.setDetached(false);
      });
    })().catch((err) => {
      console.warn("onCloseRequested failed:", err);
      return null;
    });
    return () => {
      canceled = true;
      ready.then((un) => {
        if (un) un();
      });
    };
  }, [props.isHost, props.detached]);
}

async function pushFullState(p: BridgeProps): Promise<void> {
  const payload: ChatStatePayload = {
    messages: p.messages,
    draft: p.draft,
    attachCanvas: p.attachCanvas,
    isLoading: p.isLoading,
    error: p.error,
    hasApiKey: p.hasApiKey,
  };
  try {
    // チャットウィンドウには設定済みかどうかだけを送る。
    await emitTo(CHAT_WINDOW_LABEL, STATE_EVENT, payload);
  } catch {
    // Tauri未利用環境では無視
  }
}
