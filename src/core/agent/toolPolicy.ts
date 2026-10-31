// 共通APIが増えてもAIの権限を自動で広げない。公開一覧と実行時の両方で使う。
const DRAWING_AGENT_TOOLS = new Set([
  "document.get_state",
  "document.get_image",
  "document.sample_color",
  "drawing.stroke",
  "drawing.stroke_batch",
  "drawing.erase",
  "drawing.shape",
  "drawing.path",
  "drawing.fill",
  "drawing.gradient",
  "drawing.blur",
  "drawing.color_adjust",
  "layer.add",
  "layer.add_group",
  "layer.add_text",
  "layer.duplicate",
  "layer.update_text",
  "layer.reorder",
  "layer.set_active",
  "layer.update_meta",
  "layer.pick",
  "selection.get",
  "selection.get_mask",
  "selection.set_mask",
  "selection.set",
  "selection.magic",
  "selection.transform",
]);

// 共通のundo/redoは開始前のユーザー履歴にも届くため公開しない。
export function isDrawingAgentToolAllowed(name: string): boolean {
  return DRAWING_AGENT_TOOLS.has(name);
}
