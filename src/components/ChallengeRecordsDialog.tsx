import { useCallback, useEffect, useState } from "react";
import { CHALLENGE_CATEGORY_LABEL } from "../core/challenges";
import {
  deleteChallengeRecord,
  loadChallengeRecords,
} from "../core/challengeRecords";
import { ChallengeRecord, ScoringStrictness, TimerMode } from "../types";
import { IconTrash } from "../ui/Icons";
import { Button, pushToast } from "../ui/primitives";

interface Props {
  open: boolean;
  refreshKey: number;
  onClose: () => void;
}

const STRICTNESS_LABEL: Record<ScoringStrictness, string> = {
  gentle: "やさしめ",
  normal: "標準",
  strict: "厳しめ",
};

const TIMER_MODE_LABEL: Record<TimerMode, string> = {
  countdown: "カウントダウン",
  countup: "カウントアップ",
};

function formatDate(time: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function formatDuration(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChallengeRecordsDialog({ open, refreshKey, onClose }: Props) {
  const [records, setRecords] = useState<ChallengeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRecords(await loadChallengeRecords());
    } catch (err) {
      setError(err instanceof Error ? err.message : "記録を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, refreshKey, reload]);

  const removeRecord = useCallback(async (record: ChallengeRecord) => {
    if (!confirm("この課題記録を削除しますか？")) return;
    setDeletingId(record.id);
    try {
      await deleteChallengeRecord(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      pushToast("課題記録を削除しました", "success");
    } catch (err) {
      pushToast(
        `削除失敗: ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (!open) return null;

  return (
    <>
      <div className="challenge-records-backdrop" onClick={onClose} />
      <div
        className="challenge-records-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="課題記録"
      >
        <div className="challenge-records-head">
          <strong>課題記録</strong>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>

        {loading && <div className="challenge-records-empty">読み込み中...</div>}
        {error && <div className="ai-error">{error}</div>}
        {!loading && !error && records.length === 0 && (
          <div className="challenge-records-empty">まだ記録がありません</div>
        )}

        {!loading && !error && records.length > 0 && (
          <div className="challenge-records-list">
            {records.map((record) => (
              <div className="challenge-record-row" key={record.id}>
                {record.thumbnailBase64 ? (
                  <img
                    src={`data:image/png;base64,${record.thumbnailBase64}`}
                    alt=""
                    className="challenge-record-thumb"
                  />
                ) : (
                  <div className="challenge-record-thumb empty" />
                )}
                <div className="challenge-record-main">
                  <div className="challenge-record-topline">
                    <span>{formatDate(record.createdAt)}</span>
                    <div className="challenge-record-actions">
                      <strong>{record.score}点</strong>
                      <button
                        className="icon-btn"
                        onClick={() => void removeRecord(record)}
                        disabled={deletingId !== null}
                        title="課題記録を削除"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                  <div className="challenge-record-prompt">{record.prompt}</div>
                  <div className="challenge-record-meta">
                    <span>{CHALLENGE_CATEGORY_LABEL[record.category]}</span>
                    <span>{TIMER_MODE_LABEL[record.timerMode]}</span>
                    <span>{formatDuration(record.durationSec)}</span>
                    <span>{STRICTNESS_LABEL[record.strictness]}</span>
                  </div>
                  <div className="challenge-record-advice">{record.advice}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="challenge-records-foot">
          <Button onClick={reload} disabled={loading}>再読み込み</Button>
          <span />
          <Button variant="primary" onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </>
  );
}
