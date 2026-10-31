import {
  AIImageMediaType,
  AIMode,
  GuideShape,
  Selection,
  WorkStage,
} from "../../types";

export interface ReferenceImage {
  id: string;
  base64: string;
  mediaType: AIImageMediaType;
  name: string;
  previewUrl: string;
}

export interface AIPanelProps {
  hasApiKey: boolean;

  prompt: string;
  setPrompt: (prompt: string) => void;

  mode: AIMode;
  setMode: (mode: AIMode) => void;

  stage: WorkStage;
  setStage: (stage: WorkStage) => void;

  references: ReferenceImage[];
  canAddReference: boolean;
  onAddReference: (file: File) => void;
  onRemoveReference: (id: string) => void;

  selection: Selection;
  zoomTarget: boolean;
  setZoomTarget: (zoomTarget: boolean) => void;

  onAnalyze: () => void;
  onLocalPalette: () => void;
  onCompare: () => void;
  hasPrevious: boolean;

  anyChatLoading: boolean;
  isLoading: boolean;
  isLoadingInAnotherTab: boolean;
  advice: string;
  error: string;

  guides: GuideShape[];
  showGuides: boolean;
  setShowGuides: (showGuides: boolean) => void;
  onClearGuides: () => void;
  onHighlightGuide: (guide: GuideShape | null) => void;

  palette: string[];
  onUsePaletteColor: (hex: string) => void;
}
