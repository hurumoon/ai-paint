import { useEffect } from "react";

export function useAgentInteractionLock(busy: boolean): void {
  useEffect(() => {
    if (!busy) return;
    // キャンバスのパン・ズームとAgentの停止操作は使える状態で保つ。
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".menubar, .toolbar, .tab-bar, .tool-options-panel, .left-panel > :not(.agent-panel), .right-panel > :not(.agent-panel)"));
    const locked = elements.filter(element => !element.hasAttribute("inert"));
    for (const element of locked) element.setAttribute("inert", "");
    return () => { for (const element of locked) element.removeAttribute("inert"); };
  }, [busy]);
}
