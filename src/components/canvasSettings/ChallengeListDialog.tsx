import { useEffect, useState } from "react";
import {
  CHALLENGE_CATEGORY_LABEL,
  createChallengeId,
  getDefaultChallengeItems,
  normalizeChallengeItems,
} from "../../core/challenges";
import { ChallengeCategory, ChallengeItem } from "../../types";
import { Button, pushToast } from "../../ui/primitives";
import { IconPlus, IconTrash } from "../../ui/Icons";

interface Props {
  open: boolean;
  items: ChallengeItem[];
  onChange: (items: ChallengeItem[]) => void;
  onClose: () => void;
}

const CATEGORY_OPTIONS = Object.keys(
  CHALLENGE_CATEGORY_LABEL
) as ChallengeCategory[];

export function ChallengeListDialog({
  open,
  items,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<ChallengeItem[]>(() =>
    normalizeChallengeItems(items)
  );
  const [newCategory, setNewCategory] = useState<ChallengeCategory>("drawing");
  const [newPrompt, setNewPrompt] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeChallengeItems(items));
    setNewCategory("drawing");
    setNewPrompt("");
  }, [items, open]);

  if (!open) return null;

  const updateItem = (id: string, patch: Partial<ChallengeItem>) => {
    setDraft((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const addItem = () => {
    const prompt = newPrompt.trim();
    if (!prompt) {
      pushToast("課題内容を入力してください", "error");
      return;
    }
    setDraft((current) => [
      ...current,
      {
        id: createChallengeId(),
        category: newCategory,
        prompt,
        enabled: true,
      },
    ]);
    setNewPrompt("");
  };

  const removeItem = (id: string) => {
    setDraft((current) => current.filter((item) => item.id !== id));
  };

  const save = () => {
    if (!draft.some((item) => item.enabled && item.prompt.trim())) {
      pushToast("有効な課題を1件以上残してください", "error");
      return;
    }
    if (draft.some((item) => !item.prompt.trim())) {
      pushToast("空の課題内容があります", "error");
      return;
    }
    const normalized = normalizeChallengeItems(draft);
    onChange(normalized);
    pushToast("課題一覧を保存しました", "success");
    onClose();
  };

  return (
    <>
      <div className="challenge-list-backdrop" onClick={onClose} />
      <div
        className="challenge-list-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="課題一覧の管理"
      >
        <div className="challenge-list-head">
          <strong>課題一覧</strong>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>

        <div className="challenge-list-add">
          <select
            className="select"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as ChallengeCategory)}
            title="課題粒度"
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {CHALLENGE_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
            placeholder="追加する課題"
          />
          <button className="icon-btn" onClick={addItem} title="課題を追加">
            <IconPlus />
          </button>
        </div>

        <div className="challenge-list-rows">
          {draft.map((item) => (
            <div className="challenge-list-row" key={item.id}>
              <label className="challenge-list-enabled" title="今日の課題に出す">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) =>
                    updateItem(item.id, { enabled: e.target.checked })
                  }
                />
              </label>
              <select
                className="select"
                value={item.category}
                onChange={(e) =>
                  updateItem(item.id, {
                    category: e.target.value as ChallengeCategory,
                  })
                }
                title="課題粒度"
              >
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {CHALLENGE_CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>
              <input
                className="input"
                value={item.prompt}
                onChange={(e) => updateItem(item.id, { prompt: e.target.value })}
                title="課題内容"
              />
              <button
                className="icon-btn"
                onClick={() => removeItem(item.id)}
                disabled={draft.length <= 1}
                title="課題を削除"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>

        <div className="challenge-list-foot">
          <Button onClick={() => setDraft(getDefaultChallengeItems())}>
            初期状態に戻す
          </Button>
          <span />
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </>
  );
}
