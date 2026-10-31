import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearClaudeApiKey,
  hasClaudeApiKey,
  setClaudeApiKey,
} from "../../core/ai/transport";
import { safeRemoveStorageItem } from "../../core/safeStorage";

const LEGACY_API_KEY_STORAGE = "ai-paint-api-key";

interface UseAIApiKeyStateOptions {
  setError: (message: string) => void;
}

export function useAIApiKeyState({ setError }: UseAIApiKeyStateOptions) {
  const [hasApiKey, setHasApiKey] = useState(false);
  const apiKeyUpdateSeq = useRef(0);

  useEffect(() => {
    // 過去版で localStorage に保存したキーが残っている場合だけ掃除する。
    safeRemoveStorageItem(LEGACY_API_KEY_STORAGE);
    hasClaudeApiKey()
      .then(setHasApiKey)
      .catch((e) => {
        setHasApiKey(false);
        setError(`保存済み API キーの確認に失敗: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [setError]);

  const setApiKey = useCallback((key: string) => {
    const seq = ++apiKeyUpdateSeq.current;
    return setClaudeApiKey(key)
      .then((hasKey) => {
        if (seq === apiKeyUpdateSeq.current) {
          setHasApiKey(hasKey);
          setError("");
        }
        return hasKey;
      })
      .catch((e) => {
        if (seq === apiKeyUpdateSeq.current) {
          setHasApiKey(false);
          setError(`API キー設定失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
        return false;
      });
  }, [setError]);

  const clearApiKey = useCallback(() => {
    const seq = ++apiKeyUpdateSeq.current;
    return clearClaudeApiKey()
      .then(() => {
        if (seq === apiKeyUpdateSeq.current) setHasApiKey(false);
        return true;
      })
      .catch((e) => {
        setError(`API キー削除失敗: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      });
  }, [setError]);

  return {
    hasApiKey,
    setApiKey,
    clearApiKey,
  };
}
