#!/usr/bin/env node
// =============================================================
// AIオフィス LINE画像送信ツール（send-line-image.mjs）
// ローカルの画像ファイルを LINE のトークに「画像」として送る部品。
//
// LINE は push メッセージにローカルファイルを直接添付できず、
// 「公開HTTPS URL」を要求する。そこで本スクリプトは：
//   1) 画像を line-harness R2 バケットにアップロード（POST /api/images）
//   2) 得られた公開URLで line-harness API（POST /api/friends/:id/messages）経由で送信
//      ※ LINEチャネルアクセストークンは line-harness が友だちレコードから自動解決する
// という2段階で「LINE画面に実物の画像を出す」を実現する。
//
// 使い方:
//   node send-line-image.mjs --image ./poster.png --to <friendId>
//   node send-line-image.mjs --image ./poster.png --to <friendId> --caption "完成しました！"
//   node send-line-image.mjs ./poster.png <friendId>            # 位置引数でもOK
//
// 必要な認証情報（秘密情報。コミット禁止・環境変数で渡す）:
//   LINE_HARNESS_API_URL … line-harness Worker の URL
//   LINE_HARNESS_API_KEY … line-harness Admin API キー
//
// これらは com.lineaioffice.bridge.plist の EnvironmentVariables に設定済みのため、
// bridge 経由で spawn された社員セッションでは自動で利用できる。
// 手動実行時は環境変数か $OFFICE_HOME/.line-harness-key ファイルで設定する。
// =============================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function mimeType(filePath) {
  return MIME_MAP[extname(filePath).toLowerCase()] || 'image/png';
}

// --- 引数パース（--key value と 位置引数の両対応）---------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// --- 認証情報の解決（環境変数 → キーファイルの順）---------------------------
// $OFFICE_HOME/.line-harness-key の書式（KEY=VALUE 形式）:
//   LINE_HARNESS_API_URL=https://line-harness.yourname.workers.dev
//   LINE_HARNESS_API_KEY=XXXXXXXXXXXXXXXX
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

// --- line-harness R2 へアップロードして公開URLを得る --------------------------
async function uploadToR2({ apiUrl, apiKey, imagePath }) {
  const buf = await readFile(imagePath);
  const mime = mimeType(imagePath);

  const res = await fetch(`${apiUrl}/api/images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': mime,
      'User-Agent': 'line-harness-mcp/1.0',
    },
    body: buf,
  });

  const text = await res.text();
  if (res.status === 401) throw new Error('R2アップロード認証エラー（401）。LINE_HARNESS_API_KEY を確認してください。');
  if (!res.ok) throw new Error(`R2アップロード失敗（${res.status}）: ${text.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`R2の応答が不正です: ${text.slice(0, 200)}`); }

  // レスポンス形式: { data: { url, ... } } または { url, ... }
  const url = json?.data?.url || json?.url;
  if (!url) throw new Error(`R2からURLを取得できませんでした: ${text.slice(0, 200)}`);
  return url;
}

// --- line-harness API 経由で LINE 画像メッセージを送信 -------------------------
// POST /api/friends/:friendId/messages
// LINEチャネルアクセストークンは line-harness が友だちレコードから自動解決する
async function sendImageViaHarness({ apiUrl, apiKey, friendId, imageUrl, caption }) {
  if (caption) {
    // テキストキャプションを先に送信
    const capRes = await fetch(`${apiUrl}/api/friends/${encodeURIComponent(friendId)}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'line-harness-mcp/1.0',
      },
      body: JSON.stringify({ messageType: 'text', content: caption }),
    });
    if (!capRes.ok) {
      const t = await capRes.text();
      throw new Error(`キャプション送信失敗（${capRes.status}）: ${t.slice(0, 200)}`);
    }
  }

  // 画像本体を送信
  const imageContent = JSON.stringify({ originalContentUrl: imageUrl, previewImageUrl: imageUrl });
  const res = await fetch(`${apiUrl}/api/friends/${encodeURIComponent(friendId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'line-harness-mcp/1.0',
    },
    body: JSON.stringify({ messageType: 'image', content: imageContent }),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error('line-harness API 認証エラー（401）。LINE_HARNESS_API_KEY を確認してください。');
  if (res.status === 404) throw new Error(`friendId が見つかりません（404）: ${friendId}`);
  if (!res.ok) throw new Error(`LINE画像送信失敗（${res.status}）: ${text.slice(0, 300)}`);
  return true;
}

// --- メイン ------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('使い方: node send-line-image.mjs --image <画像パス> --to <friendId> [--caption "文"]');
    console.log('        node send-line-image.mjs <画像パス> <friendId>');
    process.exit(0);
  }

  const imagePath = (typeof args.image === 'string') ? args.image : args._[0];
  const to = (typeof args.to === 'string') ? args.to : args._[1];
  const caption = (typeof args.caption === 'string') ? args.caption : null;

  if (!imagePath) { console.error('❌ 画像パスが必要です（--image <path> か 第1引数）。'); process.exit(2); }
  if (!existsSync(imagePath)) { console.error(`❌ 画像が見つかりません: ${imagePath}`); process.exit(2); }
  if (!to) { console.error('❌ 送信先 friendId が必要です（--to <friendId> か 第2引数）。'); process.exit(2); }

  const { apiUrl, apiKey } = await resolveHarnessCredentials();
  if (!apiUrl || !apiKey) {
    console.error('❌ LINE_HARNESS_API_URL または LINE_HARNESS_API_KEY が未設定です。');
    console.error('   環境変数か $OFFICE_HOME/.line-harness-key に設定してください。');
    console.error('   書式: LINE_HARNESS_API_URL=https://...\n        LINE_HARNESS_API_KEY=xxxx');
    process.exit(2);
  }

  console.log(`⬆️  R2へアップロード中: ${imagePath}`);
  const imageUrl = await uploadToR2({ apiUrl, apiKey, imagePath });
  console.log(`🔗 公開URL: ${imageUrl}`);

  console.log(`📤 LINEへ画像を送信中 → friendId=${to}`);
  await sendImageViaHarness({ apiUrl, apiKey, friendId: to, imageUrl, caption });
  console.log('✅ LINEに画像を送信しました。');
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
