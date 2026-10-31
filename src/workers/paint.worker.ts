/// <reference lib="webworker" />

// パフォーマンス・マルチコア活用のため、ピクセル処理をメインスレッドから切り出す。
// ImageData の buffer を Transferable で受け渡しゼロコピーする。

import { handleBlur } from "./paintWorkerBlur";
import { handleFlood } from "./paintWorkerFlood";
import {
  handleLinearGradient,
  handleRadialGradient,
} from "./paintWorkerGradient";
import { handlePalette } from "./paintWorkerPalette";
import type { PaintWorkerRequest } from "./paintWorkerTypes";

self.onmessage = (ev: MessageEvent<PaintWorkerRequest>) => {
  const req = ev.data;
  switch (req.op) {
    case "flood":
      return handleFlood(req);
    case "blur":
      return handleBlur(req);
    case "gradient-linear":
      return handleLinearGradient(req);
    case "gradient-radial":
      return handleRadialGradient(req);
    case "palette":
      return handlePalette(req);
  }
};
