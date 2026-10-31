import { flushSync } from "react-dom";
import type { PaintApi } from "../../core/paintApi";
import { DRAWING_GUIDE_ARTICLES } from "../../core/drawingGuideArticles";
import { loadDrawingActivityDays } from "../../core/drawingActivity";
import { loadChallengeRecords, saveChallengeRecord, deleteChallengeRecord } from "../../core/challengeRecords";
import { normalizeChallengeItems, saveChallengeItems, pickChallengeItem } from "../../core/challenges";
import type { ScoreChallengeInput } from "../ai/useAIChallengeScoring";
import { booleanSchema, enumSchema, objectSchema, stringSchema } from "./settingsApi";
import type { AppApiContext } from "./appApiTypes";

export function registerLearningApi(api: PaintApi, ctx: () => AppApiContext) {
  api.register({ name: "guide.list", description: "アプリの描き方ガイド（工程・線画・配色・影など）を取得", mutates: false, parameters: objectSchema({}) }, () => DRAWING_GUIDE_ARTICLES);
  api.register({ name: "activity.get", description: "日別の描画量と操作回数を取得", mutates: false, parameters: objectSchema({}) }, () => loadDrawingActivityDays());
  api.register({ name: "challenge.list", description: "練習課題一覧を取得", mutates: false, parameters: objectSchema({}) }, () => ctx().challengeItems);
  const category = enumSchema(["drawing", "color", "hand", "composition", "line", "light"]);
  api.register({ name: "challenge.update", description: "練習課題一覧を更新", mutates: true, parameters: objectSchema({ items: { type: "array", minItems: 1, maxItems: 1000, items: objectSchema({ id: stringSchema, prompt: stringSchema, category, enabled: booleanSchema }, ["id", "prompt", "category", "enabled"]) } }, ["items"]) }, args => {
    const items = normalizeChallengeItems(args.items);
    if (!saveChallengeItems(items)) throw new Error("課題一覧を保存できません");
    flushSync(() => ctx().setChallengeItems(items)); return items;
  });
  api.register({ name: "challenge.pick", description: "有効な課題から次の課題を選択", mutates: false, parameters: objectSchema({}) }, () => pickChallengeItem(ctx().challengeItems));
  api.register({ name: "challenge.score", description: "現在の絵を既存Claude機能で採点し記録", mutates: true, parameters: objectSchema({ category, prompt: stringSchema, timerMode: enumSchema(["countdown", "countup"]), durationSec: { type: "number", minimum: 0, maximum: 86400 }, strictness: enumSchema(["gentle", "normal", "strict"]) }, ["category", "prompt", "timerMode", "durationSec", "strictness"]) }, async args => {
    const record = await ctx().ai.handleScoreChallenge(args as unknown as ScoreChallengeInput);
    await saveChallengeRecord(record); return record;
  });
  api.register({ name: "challenge.records", description: "練習の採点記録を取得", mutates: false, parameters: objectSchema({}) }, () => loadChallengeRecords());
  api.register({ name: "challenge.delete_record", description: "採点記録を削除", mutates: true, parameters: objectSchema({ id: stringSchema }, ["id"]) }, async args => {
    await deleteChallengeRecord(args.id as string); return { deleted: true };
  });
}
