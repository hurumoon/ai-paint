import { useRef, useState } from "react";
import { IconTrash } from "../../ui/Icons";
import { IconButton } from "../../ui/primitives";

interface Props {
  hasApiKey: boolean;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
}

export function AIApiKeySettings({
  hasApiKey,
  setApiKey,
  clearApiKey,
}: Props) {
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitApiKey = () => {
    const value = inputRef.current?.value ?? "";
    if (value.trim()) setApiKey(value);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="ai-api-key-settings">
      <div className="ai-api-key-head">
        <strong>API キー</strong>
        <span>{hasApiKey ? "設定済み" : "未設定"}</span>
      </div>
      <div className="ai-key-row">
        <input
          ref={inputRef}
          type={showKey ? "text" : "password"}
          className="input ai-key-input"
          placeholder={
            hasApiKey
              ? "入力すると API キーを上書き"
              : "Anthropic API Key (sk-ant-...)"
          }
          onFocus={() => setShowKey(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitApiKey();
              inputRef.current?.blur();
            }
          }}
          onBlur={() => {
            setShowKey(false);
            commitApiKey();
          }}
        />
        <IconButton
          title="API キーを削除"
          onClick={() => {
            clearApiKey();
            if (inputRef.current) inputRef.current.value = "";
          }}
          disabled={!hasApiKey}
        >
          <IconTrash />
        </IconButton>
      </div>
      <div className="ai-api-key-note">
        API キーはローカルの資格情報ストアに保存し、プロジェクトファイルには含めません。
      </div>
    </div>
  );
}
