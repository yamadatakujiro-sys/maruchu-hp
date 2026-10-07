#!/usr/bin/env node
// =============================================================
//  セルフテスト（クレデンシャル不要・ネット接続なし）
//  純粋ロジック（工程の進み・ボードの読み取り・納期パース・通知文）だけを検証する。
//  実運用前に `npm run check` で壊れていないか確認する用。
// =============================================================
import assert from 'node:assert';
import { STAGES, nextStage, stageIndex, isValidStage, parseCars, parseSchedule, findStaff } from '../src/board.mjs';
import { parseDue, formatDigest } from '../src/notify.mjs';
import { I, L, R, colLetter, splitCarNum, stripSama, stageCells, rowToCar, BOARD_STAGES, FIRST_ROW } from '../src/layout.mjs';
import { buildStatusSummary } from '../src/handler.mjs';

let n = 0;
const ok = (label) => { n++; console.log(`  ✓ ${label}`); };

console.log('ホワイトボードBot セルフテスト');

// --- 工程ヘルパ ---
assert.strictEqual(STAGES[0], '入庫'); ok('先頭は入庫');
assert.strictEqual(STAGES[STAGES.length - 1], '納車済'); ok('末尾は納車済');
assert.strictEqual(nextStage('入庫'), '鈑金'); ok('入庫→鈑金');
assert.strictEqual(nextStage('塗装'), '磨き'); ok('塗装→磨き（実物の工程順）');
assert.strictEqual(nextStage('納車準備'), '納車済'); ok('納車準備→納車済');
assert.strictEqual(isValidStage('マスキング'), true); ok('マスキングは有効');
assert.strictEqual(isValidStage('存在しない工程'), false); ok('未知の工程=false');
assert.strictEqual(stageIndex('納車準備'), 8); ok('納車準備の番号=8');

// --- 列の配置（写真と同じ並び） ---
assert.strictEqual(colLetter(0), 'A'); assert.strictEqual(colLetter(25), 'Z'); assert.strictEqual(colLetter(27), 'AB'); ok('列記号');
assert.strictEqual(L.stageStart, 'J'); ok('工程は J列から');
assert.strictEqual(colLetter(I.stageStart + BOARD_STAGES.length - 1), 'Q'); ok('工程は Q列まで（8列）');
assert.strictEqual(L.due, 'R'); assert.strictEqual(L.parts, 'S'); assert.strictEqual(L.updated, 'T'); ok('納車予定=R・部品=S・更新=T');
assert.strictEqual(R.c0, 'V'); assert.strictEqual(R.cLast, 'AB'); ok('右側ブロックは V〜AB');

// --- 文字の整形 ---
assert.deepStrictEqual(splitCarNum('シエンタ／8834'), ['シエンタ', '8834']); ok('車種／番号 を分割');
assert.deepStrictEqual(splitCarNum('ワゴンR'), ['ワゴンR', '']); ok('番号なし');
assert.strictEqual(stripSama('青木 様'), '青木'); ok('「様」を外す');
assert.deepStrictEqual(stageCells('塗装', '井上'), ['', '', '', '', '井上', '', '', '']); ok('名札は塗装のマスへ');
assert.deepStrictEqual(stageCells('鈑金', ''), ['●', '', '', '', '', '', '', '']); ok('担当未定は●');

// --- 1行 → 車 ---
const row = (o) => {
  const r = Array(I.updated + 1).fill('');
  for (const [k, v] of Object.entries(o)) r[I[k]] = v;
  return r;
};
const r1 = row({ no: '4', inDate: '9/11', source: 'トヨタ系', cust: '青木 様', carNum: 'シエンタ／3252', insurance: '自費', due: '10/9', parts: 'バンパー 10/14仮' });
r1[I.stageStart + 4] = '井上'; // 塗装
const c1 = rowToCar(r1, FIRST_ROW + 3);
assert.strictEqual(c1.cust, '青木'); assert.strictEqual(c1.car, 'シエンタ'); assert.strictEqual(c1.number, '3252'); ok('お客様・車種・番号');
assert.strictEqual(c1.stage, '塗装'); assert.strictEqual(c1.staff, '井上'); ok('名札の位置＝工程、名札の名前＝担当');
assert.strictEqual(c1.id, '4'); assert.strictEqual(c1.row, 6); ok('No と行番号');
const r2 = row({ cust: '石川 様', carNum: 'プロボックス／5697' });
assert.strictEqual(rowToCar(r2, 4).stage, '入庫'); ok('名札なし＝入庫（作業前）');
const r3 = row({ cust: 'X 様', carNum: 'ヤリス' }); r3[I.stageStart] = '松本'; r3[I.stageStart + 2] = '●';
const c3 = rowToCar(r3, 5);
assert.strictEqual(c3.stage, 'マスキング'); assert.strictEqual(c3.staff, ''); ok('一番右の名札を採用・●は担当なし');
assert.strictEqual(rowToCar(row({}), 7), null); ok('空行は null');
assert.strictEqual(parseCars([r1, row({}), r2]).length, 2); ok('parseCars は空行を飛ばす');

// --- 予定表 ---
const sched = Array.from({ length: 24 }, () => ['', '', '', '', '', '']);
sched[0][0] = '10月9日（金）　予定表';
sched[7] = ['社長', '見積り', '', '打合せ', '', ''];
sched[8] = ['井上', '休み', '', '休み', '', ''];
sched[9] = ['あやか', '', '', 'キャンバス', '2R', ''];
const sc = parseSchedule(sched);
assert.strictEqual(sc.date, '10月9日（金）　予定表'); assert.strictEqual(sc.staff.length, 3); ok('予定表：日付・スタッフ3名');
assert.strictEqual(sc.staff[2].pm, 'キャンバス 2R'); assert.strictEqual(sc.staff[1].row, 9); ok('午後の予定・行番号');
assert.strictEqual(findStaff(sc.staff, '井上さん').name, '井上'); ok('スタッフ照合（さん付け）');
assert.strictEqual(findStaff(sc.staff, '田中'), null); ok('いない人は null');

// --- 状況まとめ ---
const sum = buildStatusSummary([c1, rowToCar(r2, 4)]);
assert.ok(sum.includes('〈塗装〉4.青木様のシエンタ(井上)')); ok('状況まとめに担当者つき');

// --- 納期パース ---
const today = new Date(2026, 7, 13); // 8/13
assert.strictEqual(parseDue('2026-08-14', today).getMonth(), 7); ok('parseDue YYYY-MM-DD');
assert.strictEqual(parseDue('8/16', today).getDate(), 16); ok('parseDue M/D');
assert.strictEqual(parseDue('8月16日', today).getDate(), 16); ok('parseDue 日本語');
assert.strictEqual(parseDue('', today), null); ok('parseDue 空=null');
assert.strictEqual(parseDue('10/14仮', today), null); ok('parseDue「仮」付きは読まない');

// --- 通知ダイジェスト ---
assert.strictEqual(formatDigest([], today), null); ok('アラート0件=null');
const digest = formatDigest([
  { level: 'info', text: '🔔 本日納車：小林様のノート' },
  { level: 'crit', text: '📅 8/16 3台重なり' },
  { level: 'warn', text: '⚠️ 佐藤様のフィット 遅れ' },
], today);
assert.ok(digest.includes('先回り通知')); ok('ダイジェストに見出し');
assert.ok(digest.indexOf('重なり') < digest.indexOf('遅れ')); ok('crit が warn より上');
assert.ok(digest.indexOf('遅れ') < digest.indexOf('本日納車')); ok('warn が info より上');

console.log(`\n✅ 全 ${n} 件パス`);
