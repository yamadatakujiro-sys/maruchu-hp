#!/usr/bin/env node
// =============================================================
//  セルフテスト（クレデンシャル不要・ネット接続なし）
//  純粋ロジック（工程の進み・納期パース・通知文の組み立て）だけを検証する。
//  実運用前に `npm run check` で壊れていないか確認する用。
// =============================================================
import assert from 'node:assert';
import { STAGES, nextStage, stageIndex, isValidStage } from '../src/board.mjs';
import { parseDue, formatDigest } from '../src/notify.mjs';

let n = 0;
const ok = (label) => { n++; console.log(`  ✓ ${label}`); };

console.log('工程ボードBot セルフテスト');

// --- 工程ヘルパ ---
assert.strictEqual(stageIndex(STAGES[0]), 0); ok('stageIndex 先頭=0');
assert.strictEqual(isValidStage('塗装'), true); ok('isValidStage 塗装');
assert.strictEqual(isValidStage('存在しない工程'), false); ok('isValidStage 未知=false');
assert.strictEqual(nextStage('塗装'), '組付け'); ok('nextStage 塗装→組付け');
assert.strictEqual(nextStage(STAGES[STAGES.length - 1]), STAGES[STAGES.length - 1]); ok('nextStage 末尾は据え置き');

// --- 納期パース ---
const today = new Date(2026, 7, 13); // 8/13
assert.strictEqual(parseDue('2026-08-14', today).getMonth(), 7); ok('parseDue YYYY-MM-DD');
assert.strictEqual(parseDue('8/16', today).getDate(), 16); ok('parseDue M/D');
assert.strictEqual(parseDue('8月16日', today).getDate(), 16); ok('parseDue 日本語');
assert.strictEqual(parseDue('', today), null); ok('parseDue 空=null');
assert.strictEqual(parseDue('あした', today), null); ok('parseDue 非日付=null');

// --- 通知ダイジェスト ---
assert.strictEqual(formatDigest([], today), null); ok('アラート0件=null');
const digest = formatDigest([
  { level: 'info', text: '🔔 本日納車：小林様のノート' },
  { level: 'crit', text: '📅 8/16 3台重なり' },
  { level: 'warn', text: '⚠️ 佐藤様のフィット 遅れ' },
], today);
assert.ok(digest.includes('先回り通知')); ok('ダイジェストに見出し');
// crit → warn → info の順に並ぶ
assert.ok(digest.indexOf('重なり') < digest.indexOf('遅れ')); ok('crit が warn より上');
assert.ok(digest.indexOf('遅れ') < digest.indexOf('本日納車')); ok('warn が info より上');

console.log(`\n✅ 全 ${n} 件パス`);
