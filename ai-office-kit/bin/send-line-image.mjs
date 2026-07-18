#!/usr/bin/env node
// =============================================================
// AIオフィス LINE画像送信ツール（send-line-image.mjs）
// ローカルの画像ファイルを LINE のトークに「画像」として送る部品。
//
// LINE は push メッセージにローカルファイルを直接添付できず、
// 「公開HTTPS URL」を要求する。そこで本スクリプトは：
//   1) 画像を line-harness R2 バケットにアップロード（公開URLを取得）
//   2) 得られた公開URLで LINE Messaging API の画像メッセージを push 送信
// という2段階で「LINE画面に実物の画像を出す」を実現する。
//
// 使い方:
//   node send-line-image.mjs --image ./poster.png --to <friendId>
//   node send-line-image.mjs --image ./poster.png --to <friendId> --caption "完成しました！"
//   node send-line-image.mjs ./poster.png <friendId>            # 位置引数でもOK
//
// 必要な認証情報（秘密情報。コミット禁止・環境変数で渡す）:
//   LINE_HARNESS_API_URL         … line-harness Worker の URL
//   LINE_HARNESS_API_KEY         … line-harness Admin API キー
//   LINE_CHANNEL_ACCESS_TOKEN    … 送信するLINE公式アカウントのチャネルアクセストークン
//     読み込み順: 環境変数 → $OFFICE_HOME/.line-channel-token
//
// LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY は com.lineaioffice.bridge.plist の
// EnvironmentVariables に設定済みのため、bridge 経由の spawn では自動で利用できる。
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
async function resolveSecret(envName, fileName) {
  if (process.env[envName]) return process.env[envName].trim();
  const candidates = [
    process.env.OFFICE_HOME ? join(process.env.OFFICE_HOME, fileName) : null,
    join(__dirname, fileName),
    join(__dirname, '..', fileName),
    join(__dirname, '..', 'config', fileName),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      const t = (await readFile(p, 'utf8')).split('\n')[0].trim();
      if (t) return t;
    }
  }
  return null;
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

  const url = json?.data?.url || json?.url;
  if (!url) throw new Error(`R2からURLを取得できませんでした: ${text.slice(0, 200)}`);
  return url;
}

// --- LINE 画像メッセージを push 送信 -----------------------------------------
async function pushLineImage({ token, to, imageUrl, caption }) {
  const messages = [];
  if (caption) messages.push({ type: 'text', text: caption });
  messages.push({ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl });

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error('LINEチャネルアクセストークンが無効です（401）。LINE_CHANNEL_ACCESS_TOKEN を確認してください。');
  if (res.status === 400) throw new Error(`LINE送信失敗（400・宛先friendIdや画像URLを確認）: ${text.slice(0, 300)}`);
  if (!res.ok) throw new Error(`LINE送信失敗（${res.status}）: ${text.slice(0, 300)}`);
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

  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey || apiKey === 'XXXXXXXXXXXXXXXX') {
    console.error('❌ LINE_HARNESS_API_URL または LINE_HARNESS_API_KEY が未設定です。');
    console.error('   com.lineaioffice.bridge.plist の EnvironmentVariables に追記してください。');
    process.exit(2);
  }

  const lineToken = await resolveSecret('LINE_CHANNEL_ACCESS_TOKEN', '.line-channel-token');
  if (!lineToken) {
    console.error('❌ LINEチャネルアクセストークンが見つかりません。');
    console.error('   環境変数 LINE_CHANNEL_ACCESS_TOKEN か $OFFICE_HOME/.line-channel-token に設定してください。');
    process.exit(2);
  }

  console.log(`⬆️  R2へアップロード中: ${imagePath}`);
  const imageUrl = await uploadToR2({ apiUrl, apiKey, imagePath });
  console.log(`🔗 公開URL: ${imageUrl}`);

  console.log(`📤 LINEへ画像を送信中 → friendId=${to}`);
  await pushLineImage({ token: lineToken, to, imageUrl, caption });
  console.log('✅ LINEに画像を送信しました。');
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
