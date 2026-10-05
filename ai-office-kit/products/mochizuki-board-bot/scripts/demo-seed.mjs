#!/usr/bin/env node
// =============================================================
//  デモ用シード（訪問デモの“仕込み”専用）
//
//  ・実行した「その日」を基準に納車予定(F列)を自動計算するので、
//    いつ叩いても必ず「今日以降」の日付で車が並ぶ（デモが古く見えない）。
//  ・先回り通知の3種類が全部出るように車を配置してある：
//      📅 納車被り … 同じ日に2台（鈴木様・山本様）
//      ⚠️ 遅れ    … 納期が近いのにまだ前工程（佐藤様・田中様）
//      🔔 本日納車 … 今日が納車予定（田中様・小林様）
//  ・既存の行はきれいに上書きする（A2〜をまとめて書き換え＋余りを空に）。
//
//  前提：SETUP.md 通りに .env と共有設定が済んでいること。
//
//  使い方:
//    node scripts/demo-seed.mjs        … デモ用の車を投入
//    （そのあと）node bin/notify.mjs --force   … 先回り通知を実演
// =============================================================
import { BOARD, CONFIG } from '../src/config.mjs';
import { updateValues } from '../src/sheets.mjs';

const TAB = CONFIG.sheetTab;

const p = (n) => n.toString().padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 今日からの相対日を YYYY-MM-DD で返す（today以降を保証）
function due(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const now = stamp();

// 列: ID / お客様 / 車種 / ナンバー / 工程 / 納車予定 / 担当 / 更新日時 / メモ
// すべて「今日(+0)以降」の納車予定。工程は実データが分かったら差し替え。
const DEMO = [
  [1, '渡辺', 'プリウス',    '静岡301あ12-34', '入庫',    due(5), '', now, ''],
  [2, '鈴木', 'N-BOX',       '',               '分解',    due(3), '', now, ''],            // 納車被り(+3)
  [3, '佐藤', 'フィット',    '',               '板金',    due(1), '', now, '左フロントぶつけ'], // 遅れ(あと1日で板金)
  [4, '田中', 'ハイエース',  '',               '塗装',    due(0), '', now, ''],            // 本日納車なのに塗装＝遅れ+本日
  [5, '山本', 'アルファード', '',               '組付け',  due(3), '', now, ''],            // 納車被り(+3)
  [6, '中村', 'タント',      '',               '検査',    due(4), '', now, ''],
  [7, '小林', 'ノート',      '',               '納車待ち', due(2), '', now, ''],            // 間に合ってる例（アラート無し）
];

// 余った古い行を消すためのパディング（空行）。合計50行まで空で埋める。
const BLANK = Array(BOARD.sheet.header.length).fill('');
const rows = DEMO.slice();
while (rows.length < 50) rows.push(BLANK.slice());

(async () => {
  const header = BOARD.sheet.header;
  await updateValues(`${TAB}!A1`, [header]);
  await updateValues(`${TAB}!A2`, rows);
  console.log(`✅ デモ用の車 ${DEMO.length} 台を投入しました（基準日 ${due(0)}）。`);
  console.log('   納車予定はすべて「今日以降」で自動計算済み。');
  console.log('');
  console.log('次に `node bin/notify.mjs --force` を叩くと、こう届きます：');
  console.log('   📅 納車被り … 鈴木様・山本様（' + due(3) + '）');
  console.log('   ⚠️ 遅れ    … 佐藤様フィット（' + due(1) + '・板金）/ 田中様ハイエース（本日・塗装）');
  console.log('   🔔 本日納車 … 田中様ハイエース（本日なのにまだ塗装＝一番刺さる例）');
})().catch((e) => {
  console.error('❌ 失敗:', e.message);
  console.error('・タブ名が「' + TAB + '」か／サービスアカウントに編集者で共有したか／GOOGLE_SHEET_ID が正しいか を確認。');
  process.exit(1);
});
