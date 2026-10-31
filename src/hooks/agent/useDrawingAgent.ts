import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createPaintApi, type PaintApiDefinition, type PaintApiExecuteResult } from "../../core/paintApi";
import { DrawingAgent } from "../../core/agent/runner";
import { getDrawingAgentSession, setDrawingAgentSession } from "../../core/agent/session";
import { getCustomBrush, getCustomBrushBitmap } from "../../core/customBrush";
import { registerAppApi } from "./appApi";
import { registerAiFeatureApi } from "./aiFeatureApi";
import { registerLearningApi } from "./learningApi";
import { agentControlDefinitions, executeAgentControl } from "./agentControlApi";
import { getSessionLoadRevision } from "../../core/agent/documentSessionRevision";
import type { AppApiContext } from "./appApiTypes";

declare global {
  interface Window {
    aiPaint?: {
      list(): PaintApiDefinition[];
      execute(name: string, args?: Record<string, unknown>): Promise<PaintApiExecuteResult>;
    };
  }
}

export function useDrawingAgent(context: AppApiContext) {
  const contextRef = useRef(context);
  const agentRef = useRef<DrawingAgent | null>(null);
  useLayoutEffect(() => { contextRef.current = context; });
  const store = context.tabStore;
  const api = useMemo(() => {
    const get = () => contextRef.current;
    const registry = createPaintApi({
      getDocument: () => store.getActiveTab()?.doc ?? null,
      getHistory: () => store.getActiveTab()?.history ?? null,
      getTimelapse: () => store.getActiveTab()?.timelapse ?? null,
      getSelection: () => get().view.selection,
      setSelection: selection => flushSync(() => get().view.setSelection(selection)),
      isBusy: () => get().actions.fileActions.isFileLoading() || get().actions.fileActions.savingRef.current || get().actions.fileActions.paintBusyRef.current || get().actions.autoBackup.isOperationBusy(),
      beginMutation: name => {
        if (!/^(drawing|layer|selection|canvas|history)\./.test(name) && name !== "file.open") return;
        // Worker の await 中も途中のピクセルを自動バックアップへ保存させない。
        const busy = get().actions.fileActions.paintBusyRef;
        busy.current = true;
        return () => { busy.current = false; };
      },
      resolveCustomBrush: async id => {
        const definition = getCustomBrush(id);
        const bitmap = await getCustomBrushBitmap(id);
        return definition && bitmap ? { bitmap, spacingRatio: definition.spacingRatio, tint: definition.tint } : null;
      },
    });
    registerAppApi(registry, get);
    registerAiFeatureApi(registry, get);
    registerLearningApi(registry, get);
    return registry;
  }, [store]);
  useEffect(() => {
    let mutations = 0;
    let alreadyInert = false;
    const facade = {
      list: () => [...api.list(), ...structuredClone(agentControlDefinitions)],
      execute: async (name: string, args: Record<string, unknown> = {}): Promise<PaintApiExecuteResult> => {
        if (name.startsWith("agent.") && agentRef.current) {
          if (name === "agent.start" || name === "agent.start_reference" || name === "agent.resume") flushSync(() => contextRef.current.openAgentWorkspace());
          return executeAgentControl(agentRef.current, name, args);
        }
        if (contextRef.current.agentRunning()) return { ok: false, error: { code: "BUSY", message: "AIドロー（β版） を一時停止してから操作してください" } };
        const mutates = api.list().find(d => d.name === name)?.mutates;
        const app = document.querySelector(".app");
        if (mutates) {
          if (mutations++ === 0) alreadyInert = app?.hasAttribute("inert") ?? false;
          app?.setAttribute("inert", "");
        }
        try { return await api.execute(name, args); }
        finally { if (mutates && --mutations === 0 && !alreadyInert) app?.removeAttribute("inert"); }
      },
    };
    window.aiPaint = facade;
    return () => { if (window.aiPaint === facade) delete window.aiPaint; };
  }, [api]);
  const tab = context.tabStore.getActiveTab();
  const doc = tab?.doc;
  const tabId = tab?.id;
  const restoreGeneration = getSessionLoadRevision(doc);
  const agent = useMemo(() => new DrawingAgent({
    paintApi: api,
    bindingId: tabId ?? "no-document",
    isBindingAvailable: () => Boolean(doc && store.getActiveTab()?.doc === doc && getSessionLoadRevision(doc) === restoreGeneration),
    session: doc ? rebindSession(doc, tabId!) : undefined,
    onSessionChange: session => {
      if (!doc || getSessionLoadRevision(doc) !== restoreGeneration) return;
      setDrawingAgentSession(doc, session);
      doc.invalidate();
    },
  }), [api, doc, store, tabId, restoreGeneration]);
  useLayoutEffect(() => { agentRef.current = agent; }, [agent]);
  useEffect(() => () => { agent.pause(); }, [agent]);
  const state = useSyncExternalStore(agent.subscribe, agent.getSnapshot);
  return { api, agent, state, restoreGeneration };
}

export type DrawingAgentController = ReturnType<typeof useDrawingAgent>;

function rebindSession(doc: Parameters<typeof getDrawingAgentSession>[0], tabId: string) {
  const session = getDrawingAgentSession(doc);
  // タブIDは起動ごとに変わる。ファイルに紐づく制作記録を復元先へ結び直す。
  return session ? { ...session, bindingId: tabId } : undefined;
}
