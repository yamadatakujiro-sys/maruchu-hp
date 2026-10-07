#!/usr/bin/env node
// =============================================================
//  デモ直前の「盤面リセット」
//  ホワイトボード・予定表の中身だけを見本データに戻す（見た目・書式はそのまま）。
//  日付は実行した日を基準に自動計算するので、いつ叩いても「今日以降」に並ぶ。
//
//  先回り通知の3種類が全部出る配置：
//    📅 納車被り … 2番・6番（3日後）
//    ⚠️ 遅れ    … 3番（明日なのにマスキング）・4番（今日なのに塗装）
//    🔔 本日納車 … 4番
//
//  ※ ボードの見た目ごと作り直したいときは scripts/build-whiteboard.mjs
//
//  使い方:
//    node scripts/demo-seed.mjs
//    （そのあと）node bin/notify.mjs --force   … 先回り通知を実演
// =============================================================
import { seedAll, md } from '../src/seed.mjs';
import { TABS } from '../src/layout.mjs';

(async () => {
  const r = await seedAll();
  console.log(`✅ 盤面を見本データに戻しました（車${r.cars}台・スタッフ${r.staff}名／基準日 ${md(0)}）。`);
  console.log('');
  console.log('`node bin/notify.mjs --force` で、こう届きます：');
  console.log(`   📅 納車被り … 石川様・片山様（${md(3)}）`);
  console.log(`   ⚠️ 遅れ    … 上田様ノート（${md(1)}・マスキング）／大野様ハイエース（本日・塗装）`);
  console.log('   🔔 本日納車 … 大野様ハイエース');
})().catch((e) => {
  console.error('❌ 失敗:', e.message);
  console.error(`・先に node scripts/build-whiteboard.mjs で「${TABS.board}」タブを作ったか確認してください。`);
  process.exit(1);
});
