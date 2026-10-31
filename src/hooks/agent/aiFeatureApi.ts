import { flushSync } from "react-dom";
import type { PaintApi } from "../../core/paintApi";
import type { AppApiContext } from "./appApiTypes";
import { fileFromDataUrl } from "./appApi";
import { booleanSchema, enumSchema, objectSchema, stringSchema } from "./settingsApi";
import { getClaudeModelSettings, setClaudeModelSettings, resetClaudeModelSettings, type ClaudeModelSettings } from "../../core/aiModelSettings";

export function registerAiFeatureApi(api: PaintApi, ctx: () => AppApiContext) {
  api.register({ name: "ai.get_state", description: "既存AI評価・チャットの状態と結果を取得", mutates: false, parameters: objectSchema({}) }, () => ({
    configured: ctx().ai.hasApiKey, prompt: ctx().ai.aiPrompt, mode: ctx().ai.aiMode, stage: ctx().ai.stage,
    advice: ctx().ai.advice, error: ctx().ai.error, guides: ctx().ai.guides, palette: ctx().ai.palette,
    references: ctx().ai.references.map(r => ({ id: r.id, name: r.name })),
    messages: ctx().chat.chatMessages.map(m => ({ id: m.id, role: m.role, text: m.text, guides: m.guides, palette: m.palette })),
  }));
  api.register({ name: "ai.analyze", description: "既存のClaude評価を実行し結果を取得", mutates: true,
    parameters: objectSchema({ prompt: stringSchema, mode: enumSchema(["general", "pose", "composition", "anatomy", "color", "lines", "palette"]), stage: enumSchema(["rough", "lineart", "baseColor", "shadow", "highlight", "final"]), zoomTarget: booleanSchema }) }, async args => {
    flushSync(() => {
      if (args.prompt !== undefined) ctx().ai.setAIPrompt(args.prompt as string);
      if (args.mode !== undefined) ctx().ai.setAIMode(args.mode as AppApiContext["ai"]["aiMode"]);
      if (args.stage !== undefined) ctx().ai.setStage(args.stage as AppApiContext["ai"]["stage"]);
      if (args.zoomTarget !== undefined) ctx().ai.setZoomTarget(args.zoomTarget as boolean);
    });
    await ctx().ai.handleAnalyze();
    const tab = ctx().tabStore.getActiveTab();
    if (tab?.uiState.error) throw new Error(tab.uiState.error);
    return { advice: tab?.uiState.advice, guides: tab?.uiState.guides, palette: tab?.uiState.palette };
  });
  api.register({ name: "ai.compare", description: "前回の絵と比較して評価", mutates: true, parameters: objectSchema({}) }, async () => {
    await ctx().ai.handleCompare();
    const state = ctx().tabStore.getActiveTab()?.uiState;
    if (state?.error) throw new Error(state.error);
    return { advice: state?.advice, guides: state?.guides };
  });
  api.register({ name: "ai.extract_palette", description: "キャンバスから色を抽出", mutates: true, parameters: objectSchema({}) }, async () => {
    const result = await ctx().ai.handleLocalPalette();
    if (!result.ok) throw new Error(result.error);
    return { palette: result.value };
  });
  api.register({ name: "ai.show_guides", description: "AIガイドの表示を切り替え", mutates: true, parameters: objectSchema({ visible: booleanSchema }, ["visible"]) }, args => { ctx().ai.setShowGuides(args.visible as boolean); return { visible: args.visible }; });
  api.register({ name: "ai.clear_guides", description: "AIガイドを消去", mutates: true, parameters: objectSchema({}) }, () => { ctx().ai.setGuides([]); return { cleared: true }; });
  api.register({ name: "ai.add_reference", description: "参考画像を追加", mutates: true, parameters: objectSchema({ dataUrl: { type: "string", maxLength: 28_000_000 }, name: stringSchema }, ["dataUrl", "name"]) }, async args => {
    const result = await ctx().ai.handleAddReference(fileFromDataUrl(args.dataUrl as string, args.name as string));
    if (!result.ok) throw new Error(result.error);
    return { id: result.value.id, name: result.value.name };
  });
  api.register({ name: "ai.remove_reference", description: "参考画像を削除", mutates: true, parameters: objectSchema({ id: stringSchema }, ["id"]) }, args => {
    if (!ctx().ai.references.some(r => r.id === args.id)) throw new Error("参考画像がありません");
    flushSync(() => ctx().ai.handleRemoveReference(args.id as string)); return { removed: true };
  });
  api.register({ name: "ai.get_reference", description: "参考画像を画像として取得し細部を確認", mutates: false, parameters: objectSchema({ id: stringSchema }, ["id"]) }, args => {
    const reference = ctx().ai.references.find(r => r.id === args.id);
    if (!reference) throw new Error("参考画像がありません");
    return { id: reference.id, name: reference.name, dataUrl: `data:${reference.mediaType};base64,${reference.base64}` };
  });
  api.register({ name: "chat.send", description: "既存のClaudeチャットへ送信し回答を取得", mutates: true, parameters: objectSchema({ text: stringSchema, attachCanvas: booleanSchema }, ["text"]) }, async args => {
    flushSync(() => ctx().chat.setChatAttachCanvas(args.attachCanvas === true));
    await ctx().chat.handleChatSend(args.text as string);
    const state = ctx().tabStore.getActiveTab()?.uiState;
    if (state?.chatError) throw new Error(state.chatError);
    return { messages: state?.chatMessages.map(m => ({ id: m.id, role: m.role, text: m.text, guides: m.guides, palette: m.palette })) };
  });
  api.register({ name: "chat.apply", description: "チャットの提案をガイド・パレットに反映", mutates: true, parameters: objectSchema({ messageId: stringSchema, guides: booleanSchema, palette: booleanSchema }, ["messageId"]) }, args => {
    const message = ctx().chat.chatMessages.find(m => m.id === args.messageId);
    if (!message) throw new Error("チャットのメッセージがありません");
    if (args.guides !== false && message.guides) ctx().chat.handleApplyChatGuides(message.guides);
    if (args.palette !== false && message.palette) ctx().chat.handleApplyChatPalette(message.palette);
    return { applied: true };
  });
  api.register({ name: "chat.clear", description: "チャットを消去", mutates: true, parameters: objectSchema({}) }, () => { ctx().chat.handleChatClear(); return { cleared: true }; });
  api.register({ name: "chat.detach", description: "チャットを別ウィンドウで開く", mutates: true, parameters: objectSchema({}) }, async () => { await ctx().chat.handleDetachChatWindow(); return { opened: true }; });
  api.register({ name: "ai.model_settings.get", description: "既存Claude機能のモデル設定を取得", mutates: false, parameters: objectSchema({}) }, () => getClaudeModelSettings());
  const modelConfig = objectSchema({ model: { type: "string", minLength: 1, maxLength: 200 }, maxTokens: { type: "integer", minimum: 1, maximum: 64000 } }, ["model", "maxTokens"]);
  api.register({ name: "ai.model_settings.update", description: "既存Claude機能のモデル設定を更新", mutates: true, parameters: objectSchema({ canvasAnalysis: modelConfig, chat: modelConfig, challengeScoring: modelConfig }, ["canvasAnalysis", "chat", "challengeScoring"]) }, args => setClaudeModelSettings(args as ClaudeModelSettings));
  api.register({ name: "ai.model_settings.reset", description: "既存Claude機能のモデル設定を初期化", mutates: true, parameters: objectSchema({}) }, () => resetClaudeModelSettings());
}
