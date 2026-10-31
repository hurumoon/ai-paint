import type { GuideShape } from "../types";

export type ChatActionType =
  | "send"
  | "clear"
  | "draft"
  | "attachCanvas"
  | "applyGuides"
  | "clearGuides"
  | "applyPalette";

export interface ChatActionPayload {
  type: ChatActionType;
  draft?: string;
  attachCanvas?: boolean;
  guides?: GuideShape[];
  palette?: string[];
}

export interface ChatActionHandlers {
  setDraft: (value: string) => void;
  setAttachCanvas: (value: boolean) => void;
  onSend: (overrideDraft?: string) => void;
  onClear: () => void;
  onApplyGuides: (guides: GuideShape[]) => void;
  onClearGuides: () => void;
  onApplyPalette: (palette: string[]) => void;
}

export function handleChatActionPayload(
  payload: ChatActionPayload,
  handlers: ChatActionHandlers
): void {
  switch (payload.type) {
    case "send":
      if (typeof payload.draft === "string") handlers.setDraft(payload.draft);
      handlers.onSend(payload.draft);
      break;
    case "clear":
      handlers.onClear();
      break;
    case "draft":
      if (typeof payload.draft === "string") handlers.setDraft(payload.draft);
      break;
    case "attachCanvas":
      if (typeof payload.attachCanvas === "boolean") {
        handlers.setAttachCanvas(payload.attachCanvas);
      }
      break;
    case "applyGuides":
      if (Array.isArray(payload.guides)) handlers.onApplyGuides(payload.guides);
      break;
    case "clearGuides":
      handlers.onClearGuides();
      break;
    case "applyPalette":
      if (Array.isArray(payload.palette)) handlers.onApplyPalette(payload.palette);
      break;
  }
}
