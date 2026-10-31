import type { ChatMessage } from "../types";

export const OMITTED_CHAT_IMAGE_TEXT = "［以前の添付画像は省略済み。必要な場合は再添付してください］";

// 追質問で参照できる画像を1枚だけ残す。プレビューも同じ画像データを
// 含むため、送信用base64だけでなくdata URLも一緒に手放す。
export function retainLatestChatImage(messages: ChatMessage[]): ChatMessage[] {
  let latestImageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].imageBase64) {
      latestImageIndex = i;
      break;
    }
  }
  return messages.map((message, index) => {
    if (index === latestImageIndex || (!message.imageBase64 && !message.imagePreviewUrl)) {
      return message;
    }
    const retained = { ...message, imageOmitted: true };
    delete retained.imageBase64;
    delete retained.imagePreviewUrl;
    return retained;
  });
}
