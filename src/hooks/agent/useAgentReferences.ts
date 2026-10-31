import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DrawingAgent } from "../../core/agent/runner";
import { createAgentReference, MAX_AGENT_REFERENCES, type DrawingAgentReference } from "../../core/agent/referenceImages";

class ReferenceDraft {
  references: DrawingAgentReference[];
  private revision = 0;
  private listeners = new Set<() => void>();
  private savedReferences: DrawingAgentReference[];
  private sessionId?: string;
  constructor(references: DrawingAgentReference[], sessionId?: string) {
    this.references = references; this.savedReferences = references; this.sessionId = sessionId;
  }
  synchronize(references: DrawingAgentReference[], sessionId?: string) {
    if (this.sessionId === sessionId && equalReferences(this.savedReferences, references)) return;
    this.sessionId = sessionId; this.savedReferences = references;
    if (!equalReferences(this.references, references)) { this.references = references; this.emit(); }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.revision;
  private emit() { this.revision++; for (const listener of this.listeners) listener(); }
  async add(files: File[]) {
    if (files.length + this.references.length > MAX_AGENT_REFERENCES) throw new Error("お手本は3枚まで添付できます");
    const images = await Promise.all(files.map(createAgentReference));
    this.references = [...this.references, ...images];
    this.emit();
  }
  remove(id: string) { this.references = this.references.filter(image => image.id !== id); this.emit(); }
}

// パネルの表示切替で添付を失わず、画像データをReact stateへ複製しない。
const drafts = new WeakMap<DrawingAgent, ReferenceDraft>();
export function useAgentReferences(agent: DrawingAgent) {
  const draft = useMemo(() => {
    let result = drafts.get(agent);
    if (!result) { result = new ReferenceDraft(agent.getReferences(), agent.getSnapshot().sessionId); drafts.set(agent, result); }
    return result;
  }, [agent]);
  useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    const synchronize = () => draft.synchronize(agent.getReferences(), agent.getSnapshot().sessionId);
    synchronize();
    return agent.subscribe(synchronize);
  }, [agent, draft]);
  return draft;
}

function equalReferences(left: DrawingAgentReference[], right: DrawingAgentReference[]): boolean {
  return left.length === right.length && left.every((image, index) => {
    const other = right[index];
    return image.id === other.id && image.name === other.name && image.dataUrl === other.dataUrl &&
      image.width === other.width && image.height === other.height && image.byteLength === other.byteLength;
  });
}
