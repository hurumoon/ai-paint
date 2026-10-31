import type { Dispatch, SetStateAction } from "react";
import type { DrawingAgentPanelProps } from "../agent/DrawingAgentWorkspace";
import type { ReferenceImage } from "../AIPanel";
import type { GridConfig } from "../GridSettings";
import type { LayoutConfig } from "../../core/panelLayout";
import type { History } from "../../core/History";
import type { PaintDocument, PixelLayer } from "../../core/PaintDocument";
import type { Timelapse } from "../../core/Timelapse";
import type {
  AIMode,
  ChatMessage,
  GuideShape,
  Selection,
  TextLayerData,
  WorkStage,
} from "../../types";

export interface AppPanelsDocumentState {
  doc: PaintDocument | null;
  history: History | null;
  timelapse: Timelapse | null;
  editingTextLayer: PixelLayer | null;
  onTextChange: (patch: Partial<TextLayerData>) => void;
  onTextDelete: () => void;
}

export interface AppPanelsViewState {
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  rotation: number;
  setRotation: Dispatch<SetStateAction<number>>;
  canvasFlipped: boolean;
  setCanvasFlipped: Dispatch<SetStateAction<boolean>>;
  grid: GridConfig;
  setGrid: Dispatch<SetStateAction<GridConfig>>;
}

export interface AppPanelsChatState {
  chatDetached: boolean;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  chatError: string;
  chatDraft: string;
  setChatDraft: Dispatch<SetStateAction<string>>;
  chatAttachCanvas: boolean;
  setChatAttachCanvas: Dispatch<SetStateAction<boolean>>;
  onChatSend: () => void;
  onChatClear: () => void;
  onApplyChatGuides: (guides: GuideShape[]) => void;
  onClearChatGuides: () => void;
  onApplyChatPalette: (palette: string[]) => void;
  onDetachChatWindow: () => void;
}

export interface AppPanelsAIAuthState {
  hasApiKey: boolean;
}

export interface AppPanelsAIInputState {
  aiPrompt: string;
  setAIPrompt: Dispatch<SetStateAction<string>>;
  aiMode: AIMode;
  setAIMode: Dispatch<SetStateAction<AIMode>>;
  stage: WorkStage;
  setStage: Dispatch<SetStateAction<WorkStage>>;
  references: ReferenceImage[];
  canAddReference: boolean;
  onAddReference: (file: File) => void;
  onRemoveReference: (id: string) => void;
}

export interface AppPanelsAITargetState {
  selection: Selection;
  zoomTarget: boolean;
  setZoomTarget: Dispatch<SetStateAction<boolean>>;
}

export interface AppPanelsAIActionsState {
  onAnalyze: () => void;
  onLocalPalette: () => void;
  onCompare: () => void;
  hasPreviousSnapshot: boolean;
  anyChatLoading: boolean;
}

export interface AppPanelsAIOutputState {
  isLoading: boolean;
  isLoadingInAnotherTab: boolean;
  advice: string;
  error: string;
  guides: GuideShape[];
  showGuides: boolean;
  setShowGuides: Dispatch<SetStateAction<boolean>>;
  onClearGuides: () => void;
  onHighlightGuide: Dispatch<SetStateAction<GuideShape | null>>;
  palette: string[];
  onUsePaletteColor: (color: string) => void;
}

export interface AppPanelsAIState {
  auth: AppPanelsAIAuthState;
  input: AppPanelsAIInputState;
  target: AppPanelsAITargetState;
  actions: AppPanelsAIActionsState;
  output: AppPanelsAIOutputState;
}

export interface AppPanelModel {
  documentState: AppPanelsDocumentState;
  viewState: AppPanelsViewState;
  chatState: AppPanelsChatState;
  aiState: AppPanelsAIState;
  drawState: DrawingAgentPanelProps & { documentKey: string };
}

export interface AppPanelsProps {
  layout: LayoutConfig;
  panelModel: AppPanelModel;
}

export type PanelRenderContext = AppPanelModel;
