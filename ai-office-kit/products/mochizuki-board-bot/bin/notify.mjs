#!/usr/bin/env node
// =============================================================
//  先回り通知の実行本体（cron / launchd から定期実行する）
//  ボードを読み、アラートがあれば NOTIFY_TARGET へ LINE push する。
//  同じ内容を連投しないよう、前回送った内容を .state に記録して差分だけ送る。
//
//  使い方:
//    node bin/notify.mjs            … 通常（差分があれば送信）
//    node bin/notify.mjs --force    … 差分に関係なく必ず送信
//    node bin/notify.mjs --dry      … 送信せず内容だけ表示（テスト用）
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT_DIR } from '../src/config.mjs';
import { push } from '../src/line.mjs';
import { buildAlerts, formatDigest } from '../src/notify.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');

const STATE_DIR = path.join(ROOT_DIR, '.state');
const STATE_FILE = path.join(STATE_DIR, 'notify.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

(async () => {
  const today = new Date();
  const alerts = await buildAlerts(today);
  const digest = formatDigest(alerts, today);

  if (!digest) {
    console.log('[notify] アラートなし。送信しません。');
    return;
  }

  if (DRY) {
    console.log('--- (dry-run) 送信内容 ---\n' + digest);
    return;
  }

  // 差分チェック（同日・同内容なら送らない）
  const stamp = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const state = loadState();
  if (!FORCE && state.date === stamp && state.digest === digest) {
    console.log('[notify] 前回と同じ内容のため送信をスキップ（--force で強制送信）。');
    return;
  }

  if (!CONFIG.notifyTarget) {
    console.error('[notify] NOTIFY_TARGET が未設定です。.env に通知先(グループID/ユーザーID)を設定してください。');
    console.log('--- 送信予定だった内容 ---\n' + digest);
    return;
  }

  await push(CONFIG.notifyTarget, digest);
  saveState({ date: stamp, digest });
  console.log('[notify] 送信しました。\n' + digest);
})().catch((e) => {
  console.error('[notify] 失敗:', e.message);
  process.exit(1);
});
