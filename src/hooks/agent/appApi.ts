import { flushSync } from "react-dom";
import type { PaintApi, JsonSchema } from "../../core/paintApi";
import { buildSaveBlob, OPEN_IMAGE_FILTERS, saveFilterForFormat, type SaveFormat } from "../../core/fileFormats";
import { saveBlobToUserPath, openFileFromUserPath, isTauri, writeBlobToPath } from "../../utils/saveFile";
import { saveTabDocument } from "../fileActions/fileSaveWorkflow";
import { loadFileIntoApp } from "../fileActions/fileLoadWorkflows";
import { tabHasUnsavedChanges } from "../useTabs";
import { addCustomBrush, listCustomBrushes, removeCustomBrush, updateCustomBrush } from "../../core/customBrush";
import { booleanSchema, enumSchema, numberSchema, objectSchema, registerSettingsApi, stringSchema } from "./settingsApi";
import type { AppApiContext } from "./appApiTypes";
import { getReferenceViewState, setReferenceViewImage, updateReferenceView } from "../../core/referenceViewState";

export function fileFromDataUrl(dataUrl: string, name: string): File {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || dataUrl.length > 28_000_000) throw new Error("ファイルデータが不正か、大きすぎます");
  const binary = atob(match[2]);
  return new File([Uint8Array.from(binary, c => c.charCodeAt(0))], name, { type: match[1] });
}
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("ファイルデータを取得できません"));
    reader.readAsDataURL(blob);
  });
}
const idSchema = { type: "string", minLength: 1, maxLength: 256 };
const dataSchema = { type: "string", maxLength: 28_000_000, pattern: "^data:[^;,]+;base64," };

export function registerAppApi(api: PaintApi, ctx: () => AppApiContext) {
  const register = (name: string, description: string, mutates: boolean, properties: Record<string, JsonSchema>, required: string[], run: (args: Record<string, unknown>) => unknown | Promise<unknown>) =>
    api.register({ name, description, mutates, parameters: objectSchema(properties, required) }, run);
  const target = () => {
    const tab = ctx().tabStore.getActiveTab();
    if (!tab) throw new Error("キャンバスがありません");
    return tab;
  };
  const idle = () => {
    if (ctx().agentRunning()) throw new Error("AIドロー（β版） を一時停止してからタブ・ファイルを変更してください");
  };
  registerSettingsApi(api, ctx);
  register("reference.get", "リファレンス表示の画像と表示位置を取得", false, {}, [], () => {
    const { src, ...view } = getReferenceViewState();
    return { dataUrl: src, ...view };
  });
  register("reference.update", "リファレンス画像・ズーム・位置・原寸表示を変更", true, {
    dataUrl: { anyOf: [dataSchema, { type: "null" }] }, zoom: numberSchema(0.2, 8),
    offset: objectSchema({ x: numberSchema(-1e6, 1e6), y: numberSchema(-1e6, 1e6) }, ["x", "y"]), popup: booleanSchema,
  }, [], async args => {
    if (typeof args.dataUrl === "string") {
      const file = fileFromDataUrl(args.dataUrl, "reference.png");
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("PNG / JPEG / WebP / GIF の画像を指定してください");
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 4096 * 4096) throw new Error("参考画像の解像度が大きすぎます");
    }
    if (args.dataUrl !== undefined) setReferenceViewImage(args.dataUrl as string | null);
    updateReferenceView({
      ...(args.zoom === undefined ? {} : { zoom: args.zoom as number }),
      ...(args.offset === undefined ? {} : { offset: args.offset as { x: number; y: number } }),
      ...(args.popup === undefined ? {} : { popup: args.popup as boolean }),
    });
    return { updated: true };
  });
  register("app.get_state", "タブ、保存状態、利用環境を取得", false, {}, [], () => ({
    desktop: isTauri(), activeTabId: ctx().tabStore.activeTabId,
    tabs: ctx().tabStore.tabs.map(t => ({ id: t.id, name: t.fileName, width: t.doc.width, height: t.doc.height, dirty: tabHasUnsavedChanges(t) })),
    agentRunning: ctx().agentRunning(),
  }));
  register("tabs.create", "新規キャンバスを作成し選択", true, { width: numberSchema(1, 16384), height: numberSchema(1, 16384), dpi: numberSchema(1, 2400) }, ["width", "height"], args => {
    idle(); let id = "";
    flushSync(() => { id = ctx().stashAndAddTab(Math.round(args.width as number), Math.round(args.height as number), args.dpi as number | undefined).id; });
    return { id };
  });
  register("tabs.select", "作業対象タブを選択", true, { id: idSchema }, ["id"], args => {
    idle();
    if (!ctx().tabStore.tabs.some(t => t.id === args.id)) throw new Error("タブがありません");
    flushSync(() => ctx().actions.tabActions.handleSelectTab(args.id as string));
    if (ctx().tabStore.activeTabId !== args.id) throw new Error("現在はタブを切り替えられません");
    return { id: args.id };
  });
  register("tabs.close", "タブを閉じる。未保存なら既存の確認を表示", true, { id: idSchema }, ["id"], async args => {
    idle(); await ctx().actions.tabActions.handleCloseTab(args.id as string);
    return { closed: !ctx().tabStore.tabs.some(t => t.id === args.id) };
  });
  register("tabs.reorder", "タブの表示順を変更", true, { from: numberSchema(0, 1000), to: numberSchema(0, 1000) }, ["from", "to"], args => {
    idle();
    const length = ctx().tabStore.tabs.length;
    if (![args.from, args.to].every(v => Number.isInteger(v) && (v as number) >= 0 && (v as number) < length)) throw new Error("タブの位置が不正です");
    ctx().actions.tabActions.handleReorderTab(args.from as number, args.to as number); return { reordered: true };
  });
  register("file.save", "ドキュメントを保存。保存先がない場合は保存ダイアログを表示", true, {
    format: enumSchema(["aipaint", "psd", "png", "jpeg", "webp"]), saveAs: booleanSchema,
  }, [], async args => {
    const tab = target();
    const format = (args.format ?? "aipaint") as SaveFormat;
    const files = ctx().actions.fileActions;
    if (files.savingRef.current || files.isFileLoading() || ctx().actions.autoBackup.isOperationBusy()) throw new Error("ファイル処理中です");
    files.savingRef.current = true;
    try {
      return await saveTabDocument({ targetTab: tab, tabStore: ctx().tabStore, format, write: async blob => {
        if (format === "aipaint" && !args.saveAs && tab.filePath?.toLowerCase().endsWith(".aipaint") && isTauri()) {
          await writeBlobToPath(blob, tab.filePath);
          return { fileName: tab.fileName ?? "作品.aipaint", path: tab.filePath };
        }
        const result = await saveBlobToUserPath(blob, `作品.${format}`, saveFilterForFormat(format));
        return result.cancelled ? null : { fileName: result.fileName ?? `作品.${format}`, path: result.path };
      } });
    } finally { files.savingRef.current = false; }
  });
  // 書き出しは文書を変更しないが、await 中に描画されると保存内容が一時点の状態ではなくなる。
  // mutates は共通 API の入力ロックにも使うため、書き出し中はキャンバス操作を直列化する。
  register("file.export", "指定形式のファイルデータを取得。制作記録はaipaintのみ保持", true, { format: enumSchema(["aipaint", "psd", "png", "jpeg", "webp"]) }, ["format"], async args => {
    const files = ctx().actions.fileActions;
    if (files.savingRef.current || files.isFileLoading() || files.paintBusyRef.current || ctx().actions.autoBackup.isOperationBusy()) throw new Error("別のファイル・描画処理を実行中です");
    files.savingRef.current = true;
    try {
      const blob = await buildSaveBlob(target().doc, args.format as SaveFormat);
      if (blob.size > 20 * 1024 * 1024) throw new Error("APIで取得できるサイズを超えています。file.saveを使用してください");
      return { dataUrl: await blobToDataUrl(blob), bytes: blob.size };
    } finally { files.savingRef.current = false; }
  });
  register("file.open", "ファイルデータを読み込む。dataUrl省略時はファイル選択", true, { dataUrl: dataSchema, name: stringSchema }, [], async args => {
    idle();
    const current = ctx();
    const selected = args.dataUrl
      ? { file: fileFromDataUrl(args.dataUrl as string, (args.name ?? "画像.png") as string), cancelled: false, path: undefined }
      : isTauri() ? await openFileFromUserPath(OPEN_IMAGE_FILTERS) : await pickBrowserFile();
    if (selected.cancelled || !selected.file) return { cancelled: true };
    return loadFileIntoApp({ activeTab: current.tabStore.getActiveTab(), file: selected.file, path: selected.path, tabStore: current.tabStore, stashAndAddTab: current.stashAndAddTab });
  });
  register("backup.list", "保存済みバックアップの一覧を取得", false, {}, [], async () => {
    const entries = await ctx().actions.autoBackup.refreshBackupState();
    return entries.map(({ blob: _blob, ...entry }) => entry);
  });
  register("backup.save", "現在のドキュメントをバックアップ", true, {}, [], async () => { await ctx().actions.autoBackup.saveNow(); return { saved: true }; });
  register("backup.restore", "バックアップを復元", true, { id: idSchema, newTab: booleanSchema }, ["id"], async args => {
    idle(); const backup = ctx().actions.autoBackup;
    const entry = (await backup.refreshBackupState()).find(e => e.id === args.id);
    if (!entry) throw new Error("バックアップがありません");
    if (args.newTab !== false) await backup.openBackupInNewTab(entry);
    else await backup.restoreIntoActiveTab(entry);
    return { restored: true };
  });
  register("backup.delete", "指定したバックアップを削除", true, { ids: { type: "array", items: idSchema, maxItems: 100 } }, ["ids"], async args => {
    await ctx().actions.autoBackup.deleteBackupEntries(args.ids as string[]); return { deleted: true };
  });
  register("custom_brush.list", "登録したカスタムブラシを取得", false, {}, [], () => listCustomBrushes());
  register("custom_brush.add", "画像からカスタムブラシを登録", true, { dataUrl: dataSchema, name: stringSchema }, ["dataUrl", "name"], args => addCustomBrush(fileFromDataUrl(args.dataUrl as string, args.name as string)));
  register("custom_brush.update", "カスタムブラシを編集", true, { id: idSchema, name: stringSchema, spacingRatio: numberSchema(0.01, 5), tint: booleanSchema }, ["id"], ({ id, ...patch }) => {
    if (!listCustomBrushes().some(b => b.id === id)) throw new Error("カスタムブラシがありません");
    updateCustomBrush(id as string, patch); return { updated: true };
  });
  register("custom_brush.remove", "カスタムブラシを削除", true, { id: idSchema }, ["id"], args => {
    if (!listCustomBrushes().some(b => b.id === args.id)) throw new Error("カスタムブラシがありません");
    removeCustomBrush(args.id as string); return { removed: true };
  });
  register("timelapse.get", "既存タイムラプスの状態を取得", false, {}, [], () => ({ enabled: target().timelapse.isEnabled(), frames: target().timelapse.frameCount() }));
  register("timelapse.set_enabled", "既存タイムラプスの記録を切り替え", true, { enabled: booleanSchema }, ["enabled"], args => { target().timelapse.setEnabled(args.enabled as boolean); return { enabled: args.enabled }; });
  register("timelapse.clear", "既存タイムラプスを消去", true, {}, [], () => { target().timelapse.clear(); return { cleared: true }; });
  register("timelapse.export", "既存タイムラプスを動画として保存", false, { fps: numberSchema(1, 60) }, [], async args => {
    const blob = await target().timelapse.exportWebM((args.fps ?? 24) as number);
    if (!blob) throw new Error("タイムラプスがありません");
    return saveBlobToUserPath(blob, "制作過程.webm", { name: "WebM", extensions: ["webm"] });
  });
}

function pickBrowserFile(): Promise<{ file?: File; cancelled: boolean; path?: string }> {
  return new Promise(resolve => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".aipaint,.psd,.png,.jpg,.jpeg,.webp";
    input.onchange = () => resolve({ cancelled: !input.files?.[0], file: input.files?.[0] });
    input.oncancel = () => resolve({ cancelled: true }); input.click();
  });
}
