import { useEffect, useState } from "react";
import { loadChallengeItems, saveChallengeItems } from "../core/challenges";
import type { ChallengeItem } from "../types";
import { pushToast } from "../ui/primitives";

export function useChallengeItems() {
  const [challengeItems, setChallengeItems] = useState<ChallengeItem[]>(() =>
    loadChallengeItems()
  );

  useEffect(() => {
    if (!saveChallengeItems(challengeItems)) {
      pushToast("課題一覧を保存できませんでした。ストレージ容量を確認してください。", "error");
    }
  }, [challengeItems]);

  return { challengeItems, setChallengeItems };
}
