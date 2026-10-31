import { Button } from "../../ui/primitives";

interface Props {
  onQuickFilter: (kind: "invert" | "grayscale" | "sepia", label: string) => void;
}

export function QuickFilterControls({ onQuickFilter }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
      }}
    >
      <div style={{ color: "var(--text-faint)" }}>
        ボタンを押すと即時に履歴へ追加されます。
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button onClick={() => onQuickFilter("invert", "階調反転")}>
          階調反転
        </Button>
        <Button onClick={() => onQuickFilter("grayscale", "グレースケール")}>
          グレースケール
        </Button>
        <Button onClick={() => onQuickFilter("sepia", "セピア")}>
          セピア
        </Button>
      </div>
    </div>
  );
}
