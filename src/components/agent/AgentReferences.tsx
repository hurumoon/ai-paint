import { useRef } from "react";
import { Button } from "../../ui/primitives";
import type { useAgentReferences } from "../../hooks/agent/useAgentReferences";

interface Props {
  draft: ReturnType<typeof useAgentReferences>;
  disabled: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
  local?: boolean;
}

export function AgentReferences({ draft, disabled, run, local }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const add = (files: File[]) => { if (!disabled && files.length) void run(() => draft.add(files)); };
  return <section className="agent-references" aria-label="お手本"
    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); add(Array.from(event.dataTransfer.files)); }}
    onPaste={event => {
      const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); event.stopPropagation(); add(files); }
    }}>
    <div className="agent-section-title"><strong>お手本</strong><small>{draft.references.length} / 3枚</small>
      <Button disabled={disabled || draft.references.length >= 3} onClick={() => input.current?.click()}>画像を添付</Button></div>
    <input ref={input} type="file" aria-label="お手本画像" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={disabled}
      onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    {draft.references.length ? <div className="agent-reference-list">{draft.references.map(reference => <figure key={reference.id}>
      <img src={reference.dataUrl} alt={`お手本: ${reference.name}`} />
      <figcaption title={reference.name}>{reference.name}</figcaption>
      <button type="button" title={`${reference.name}を削除`} aria-label={`${reference.name}を削除`} disabled={disabled} onClick={() => draft.remove(reference.id)}>×</button>
    </figure>)}</div> : <div className="agent-reference-drop" tabIndex={disabled ? -1 : 0}>画像をドロップ、または貼り付け</div>}
    <small>{local ? "選んだ画像の輪郭と色を解析し、ブラシで描き直します。" : "構図・形・色の目標として送信します。再開時も反映されます。"}</small>
  </section>;
}
