import { useMemo, useSyncExternalStore } from "react";
import type { AIImagePayload } from "../core/aiImagePayload";
import { PaintDocument } from "../core/PaintDocument";
import { History, HistoryMemoryBudgetManager } from "../core/History";
import { Timelapse } from "../core/Timelapse";
import {
  ChatMessage,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  GuideShape,
  Selection,
} from "../types";

// タブ間で「切替時に保存→復元」する UI 状態。
// React の useState は App 側に置いたまま、切替時に snapshot をスワップする方式。
// (selection/zoom/pan/rotation/canvasFlipped/guides/palette は描いている内容と密結合なので
//  タブ毎に分離するのが自然。)
export interface TabUiState {
  selection: Selection;
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
  canvasFlipped: boolean;
  guides: GuideShape[];
  showGuides: boolean;
  palette: string[];
  advice: string;
  error: string;
  // チャット履歴は「そのドキュメントについて議論した内容」なのでタブ毎に持つ。
  // chatLoading はそのタブで通信中かどうか、chatError は最後のエラーメッセージ。
  // chatDetached (別ウィンドウ) はアプリ全体のフラグなので uiState には入れない。
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatAttachCanvas: boolean;
  chatLoading: boolean;
  chatError: string;
}

export const DEFAULT_TAB_UI_STATE: TabUiState = {
  selection: { kind: "none" },
  zoom: 1,
  pan: { x: 0, y: 0 },
  rotation: 0,
  canvasFlipped: false,
  guides: [],
  showGuides: true,
  palette: [],
  advice: "",
  error: "",
  chatMessages: [],
  chatDraft: "",
  chatAttachCanvas: false,
  chatLoading: false,
  chatError: "",
};

export type TabUiStatePatch = Partial<TabUiState>;

function cloneTabUiState(ui: TabUiState): TabUiState {
  return {
    selection: ui.selection,
    zoom: ui.zoom,
    pan: { x: ui.pan.x, y: ui.pan.y },
    rotation: ui.rotation,
    canvasFlipped: ui.canvasFlipped,
    guides: ui.guides.slice(),
    showGuides: ui.showGuides,
    palette: ui.palette.slice(),
    advice: ui.advice,
    error: ui.error,
    chatMessages: ui.chatMessages.slice(),
    chatDraft: ui.chatDraft,
    chatAttachCanvas: ui.chatAttachCanvas,
    chatLoading: ui.chatLoading,
    chatError: ui.chatError,
  };
}

export interface Tab {
  id: string;
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  fileName: string | null;
  filePath: string | null;
  // 「名称未設定N」表示用。fileName が null の時のみ使う。
  untitledIndex: number;
  // 最後に保存（または読み込み直後）の history.version。
  lastSavedVersion: number;
  // 最後に保存（または読み込み直後）の PaintDocument.version。
  lastSavedDocumentVersion: number;
  // AutoBackup が最後に取った history.version。
  lastBackupVersion: number;
  // AutoBackup が最後に取った PaintDocument.version。
  lastBackupDocumentVersion: number;
  // AI 比較用の前回スナップショット。送信用と同じ縮小済み payload を保持する。
  previousSnapshot: AIImagePayload | null;
  // タブ切替で退避する UI 状態。
  uiState: TabUiState;
}

type Listener = () => void;

// 全タブを React の外で管理する。アクティブタブ切替やタブ追加/削除があれば
// version を bump して useSyncExternalStore で React を再 render させる。
//
// タブが 0 個の状態を許容する: 起動時はタブを作らず、最後のタブを閉じても
// 自動で空タブを作らない。App 側で activeTab === null をハンドリングして
// プレースホルダー UI を出す。
export class TabStore {
  tabs: Tab[] = [];
  activeTabId: string | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private untitledCounter = 0;
  private readonly historyBudget: HistoryMemoryBudgetManager;

  constructor(historyBudget: number) {
    this.historyBudget = new HistoryMemoryBudgetManager(historyBudget);
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  setHistoryBudget(budget: number): void {
    this.historyBudget.setMemoryBudget(budget);
    // 予算縮小で active tab の canUndo/canRedo が変わる場合がある。
    // 履歴 version は dirty 判定に使うため進めず、TabStore の更新で再描画する。
    this.notify();
  }

  getActiveTab(): Tab | null {
    if (this.activeTabId === null) return null;
    const t = this.tabs.find((t) => t.id === this.activeTabId);
    if (t) return t;
    // activeTabId が指す先が消えていれば先頭にフォールバック。
    // タブが 0 個なら null。
    return this.tabs[0] ?? null;
  }

  private nextTabId(): string {
    const u =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `tab-${u}`;
  }

  // 空の新規ドキュメントを持つタブを作る (active には設定しない)。
  createBlankTab(width = DEFAULT_CANVAS_WIDTH, height = DEFAULT_CANVAS_HEIGHT, dpi = 96): Tab {
    const doc = new PaintDocument(width, height, 1);
    doc.setDpi(dpi);
    const history = new History(this.historyBudget);
    const timelapse = new Timelapse();
    this.untitledCounter += 1;
    return {
      id: this.nextTabId(),
      doc,
      history,
      timelapse,
      fileName: null,
      filePath: null,
      untitledIndex: this.untitledCounter,
      lastSavedVersion: history.getSnapshot(),
      lastSavedDocumentVersion: doc.getSnapshot(),
      lastBackupVersion: history.getSnapshot(),
      lastBackupDocumentVersion: doc.getSnapshot(),
      previousSnapshot: null,
      uiState: { ...DEFAULT_TAB_UI_STATE },
    };
  }

  // 新規空タブを末尾に追加して active にする。
  addBlankTab(width?: number, height?: number, dpi?: number): Tab {
    const tab = this.createBlankTab(width, height, dpi);
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.notify();
    return tab;
  }

  setActiveTab(id: string): void {
    if (this.activeTabId === id) return;
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeTabId = id;
    this.notify();
  }

  // タブを閉じる。最後の1枚を閉じた場合はタブ 0 個状態に遷移する
  // (勝手に空タブを作らない)。
  closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasActive = this.activeTabId === id;
    this.historyBudget.unregister(this.tabs[idx].history);
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.activeTabId = null;
    } else if (wasActive) {
      // 右隣優先、なければ左隣を active に。
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? this.tabs[0];
      this.activeTabId = next.id;
    }
    this.notify();
  }

  // タブの順序を [from] → [to] に並び替える。
  reorderTab(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.tabs.length) return;
    if (toIndex < 0 || toIndex >= this.tabs.length) return;
    const [moved] = this.tabs.splice(fromIndex, 1);
    this.tabs.splice(toIndex, 0, moved);
    this.notify();
  }

  // タブのメタ (fileName/filePath/lastSavedVersion/...) を部分更新。
  updateTab(id: string, patch: Partial<Omit<Tab, "id" | "doc" | "history" | "timelapse">>): void {
    const t = this.tabs.find((t) => t.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.notify();
  }

  // タブが保持する UI 状態を上書き (切替時に App から渡される)。
  // 渡された ui は App の uiStateLiveRef が参照する live なオブジェクトかもしれない
  // ので、配列/オブジェクトは shallow copy で防御する。これをやらないと、App 側で
  // 「stash 後すぐにリセット」する場面で uiStateLiveRef の中身を介して旧タブのスナップ
  // ショットまで壊してしまう可能性がある。
  setTabUiState(id: string, ui: TabUiState): void {
    const t = this.tabs.find((t) => t.id === id);
    if (!t) return;
    t.uiState = cloneTabUiState(ui);
    // UI 状態のローカル退避は React 再 render の必要なし。
  }

  patchTabUiState(id: string, patch: TabUiStatePatch): boolean {
    const t = this.tabs.find((t) => t.id === id);
    if (!t) return false;
    const chatLoadingChanged = patch.chatLoading !== undefined && patch.chatLoading !== t.uiState.chatLoading;
    t.uiState = cloneTabUiState({
      ...t.uiState,
      ...patch,
    });
    // 背景タブの送信完了でも、アプリ全体の操作ロックを更新する。
    if (chatLoadingChanged) this.notify();
    return true;
  }
}

export function tabHasUnsavedChanges(tab: Tab): boolean {
  return (
    tab.history.getSnapshot() !== tab.lastSavedVersion ||
    tab.doc.getSnapshot() !== tab.lastSavedDocumentVersion
  );
}

export interface UseTabsResult {
  store: TabStore;
  tabs: Tab[];
  activeTab: Tab | null;
  activeTabId: string | null;
}

export function useTabs(historyBudget: number): UseTabsResult {
  // historyBudget の変更は store 側で反映するため、初期化時だけ渡す。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => new TabStore(historyBudget), []);
  // historyBudget の変更は store 側で反映する (ストア再生成はしない)。
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    store,
    tabs: store.tabs,
    activeTab: store.getActiveTab(),
    activeTabId: store.activeTabId,
  };
}
