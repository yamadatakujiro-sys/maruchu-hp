#!/usr/bin/env node
// =============================================================
// AIオフィス LINE通知ツール（line-notify.mjs）
//
// オーナー（や顧客）にLINEで「テキスト1通」を送るだけの軽量部品。
// ★重要：これは line-harness API を直接叩くだけ＝**Claude(AI社員)の認証には一切依存しない**。
//   ゆえに「Claude Code のログインが切れて全社員が沈黙」した時でも、この通知は飛ぶ。
//   → 「ログイン切れました。/login してください」等の"生存アラート"を送るために使う。
//
// 使い方:
//   node line-notify.mjs "本文"                     # OWNER_FRIEND_ID 宛に送る
//   node line-notify.mjs --to <friendId> "本文"     # 宛先を明示
//
// 必要な認証情報（秘密情報。コミット禁止・環境変数か鍵ファイルで渡す）:
//   LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY
//     読み込み順: 環境変数 → $OFFICE_HOME/.line-harness-key ファイル
//   OWNER_FRIEND_ID … 既定の宛先（--to 省略時）。install.sh が全常駐の環境に注入する。
// =============================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- 引数パース（--to <id> と 位置引数の本文）--------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') { args.to = argv[++i]; }
    else if (a.startsWith('--to=')) { args.to = a.slice(5); }
    else { args._.push(a); }
  }
  return args;
}

// --- 認証情報の解決（環境変数 → $OFFICE_HOME/.line-harness-key）--------------
async function resolveHarnessCredentials() {
  let apiUrl = process.env.LINE_HARNESS_API_URL;
  let apiKey = process.env.LINE_HARNESS_API_KEY;
  if (apiUrl && apiKey && apiKey !== 'XXXXXXXXXXXXXXXX') return { apiUrl, apiKey };

  const candidates = [
    process.env.OFFICE_HOME ? join(process.env.OFFICE_HOME, '.line-harness-key') : null,
    join(__dirname, '..', '.line-harness-key'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      const lines = (await readFile(p, 'utf8')).split('\n');
      for (const line of lines) {
        const [k, ...rest] = line.split('=');
        const v = rest.join('=').trim();
        if (k?.trim() === 'LINE_HARNESS_API_URL') apiUrl = v;
        if (k?.trim() === 'LINE_HARNESS_API_KEY') apiKey = v;
      }
      if (apiUrl && apiKey) break;
    }
  }
  return { apiUrl: apiUrl || null, apiKey: apiKey || null };
}

// --- line-harness API 経由でテキスト送信 -------------------------------------
async function sendText({ apiUrl, apiKey, friendId, text }) {
  const res = await fetch(`${apiUrl}/api/friends/${encodeURIComponent(friendId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'line-harness-mcp/1.0',
    },
    body: JSON.stringify({ messageType: 'text', content: text }),
  });
  const body = await res.text();
  if (res.status === 401) throw new Error('LINE_HARNESS_API_KEY 認証エラー（401）');
  if (res.status === 404) throw new Error(`friendId が見つかりません（404）: ${friendId}`);
  if (!res.ok) throw new Error(`LINE 送信失敗（${res.status}）: ${body.slice(0, 200)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args._.join(' ').trim();
  const to = args.to || process.env.OWNER_FRIEND_ID;

  if (!text) { console.error('❌ 本文が必要です: node line-notify.mjs "本文"'); process.exit(2); }
  if (!to) { console.error('❌ 宛先が未指定です（--to <friendId> か OWNER_FRIEND_ID）。'); process.exit(2); }

  const { apiUrl, apiKey } = await resolveHarnessCredentials();
  if (!apiUrl || !apiKey) {
    console.error('❌ LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY が未設定です（環境変数か $OFFICE_HOME/.line-harness-key）。');
    process.exit(2);
  }

  await sendText({ apiUrl, apiKey, friendId: to, text });
  console.log(`✅ LINE通知を送信しました → ${to}`);
}

main().catch(e => { console.error('❌ line-notify エラー:', e.message); process.exit(1); });
