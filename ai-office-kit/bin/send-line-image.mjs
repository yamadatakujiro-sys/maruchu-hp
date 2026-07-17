#!/usr/bin/env node
// =============================================================
// AIオフィス LINE画像送信ツール（send-line-image.mjs）
// ローカルの画像ファイルを LINE のトークに「画像」として送る部品。
//
// LINE は push メッセージにローカルファイルを直接添付できず、
// 「公開HTTPS URL」を要求する。そこで本スクリプトは：
//   1) 画像を imgbb（無料の画像ホスティング）にアップロード
//   2) 得られた公開URLで LINE Messaging API の画像メッセージを push 送信
// という2段階で「LINE画面に実物の画像を出す」を実現する。
//
// 使い方:
//   node send-line-image.mjs --image ./poster.png --to <friendId>
//   node send-line-image.mjs --image ./poster.png --to <friendId> --caption "完成しました！"
//   node send-line-image.mjs ./poster.png <friendId>            # 位置引数でもOK
//
// 必要な認証情報（秘密情報。コミット禁止・環境変数かキーファイルで渡す）:
//   LINE_CHANNEL_ACCESS_TOKEN … 送信するLINE公式アカウントのチャネルアクセストークン
//     読み込み順: 環境変数 → $OFFICE_HOME/.line-channel-token → スクリプト近傍の .line-channel-token
//   IMGBB_API_KEY … imgbb の APIキー（https://api.imgbb.com/ で無料取得）
//     読み込み順: 環境変数 → $OFFICE_HOME/.imgbb-api-key → スクリプト近傍の .imgbb-api-key
//
// セットアップ手順は docs/LINE-IMAGE-SETUP.md 参照。
// =============================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --- imgbb へアップロードして公開URLを得る -----------------------------------
async function uploadToImgbb({ apiKey, imagePath }) {
  const buf = await readFile(imagePath);
  const base64 = buf.toString('base64');

  const body = new URLSearchParams();
  body.set('image', base64);
  body.set('name', basename(imagePath).replace(/\.[^.]+$/, ''));

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  if (res.status === 400) throw new Error(`imgbbアップロード失敗（400）。APIキーが正しいか確認してください: ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error(`imgbbアップロード失敗（${res.status}）: ${text.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`imgbbの応答が不正です: ${text.slice(0, 200)}`); }
  if (!json.success || !json.data) throw new Error(`imgbbアップロード失敗: ${text.slice(0, 200)}`);

  // 原寸URL＝data.url、プレビュー用は小さい版（LINEのpreviewは1MB上限）を優先
  const original = json.data.url || (json.data.image && json.data.image.url) || json.data.display_url;
  const preview = (json.data.thumb && json.data.thumb.url)
              || (json.data.medium && json.data.medium.url)
              || original;
  if (!original) throw new Error(`imgbbから画像URLを取得できませんでした: ${text.slice(0, 200)}`);
  return { original, preview };
}

// --- LINE 画像メッセージを push 送信 -----------------------------------------
async function pushLineImage({ token, to, original, preview, caption }) {
  const messages = [];
  if (caption) messages.push({ type: 'text', text: caption });
  messages.push({ type: 'image', originalContentUrl: original, previewImageUrl: preview });

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });

  const text = await res.text();
  if (res.status === 401) throw new Error('LINEチャネルアクセストークンが無効です（401）。docs/LINE-IMAGE-SETUP.md を確認してください。');
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
    console.log('詳細は docs/LINE-IMAGE-SETUP.md を参照。');
    process.exit(0);
  }

  const imagePath = (typeof args.image === 'string') ? args.image : args._[0];
  const to = (typeof args.to === 'string') ? args.to : args._[1];
  const caption = (typeof args.caption === 'string') ? args.caption : null;

  if (!imagePath) { console.error('❌ 画像パスが必要です（--image <path> か 第1引数）。'); process.exit(2); }
  if (!existsSync(imagePath)) { console.error(`❌ 画像が見つかりません: ${imagePath}`); process.exit(2); }
  if (!to) { console.error('❌ 送信先 friendId が必要です（--to <friendId> か 第2引数）。'); process.exit(2); }

  const lineToken = await resolveSecret('LINE_CHANNEL_ACCESS_TOKEN', '.line-channel-token');
  if (!lineToken) {
    console.error('❌ LINEチャネルアクセストークンが見つかりません。');
    console.error('   環境変数 LINE_CHANNEL_ACCESS_TOKEN か $OFFICE_HOME/.line-channel-token に設定してください。');
    console.error('   手順: docs/LINE-IMAGE-SETUP.md');
    process.exit(2);
  }
  const imgbbKey = await resolveSecret('IMGBB_API_KEY', '.imgbb-api-key');
  if (!imgbbKey) {
    console.error('❌ imgbb APIキーが見つかりません。');
    console.error('   環境変数 IMGBB_API_KEY か $OFFICE_HOME/.imgbb-api-key に設定してください。');
    console.error('   手順: docs/LINE-IMAGE-SETUP.md');
    process.exit(2);
  }

  console.log(`⬆️  imgbbへアップロード中: ${imagePath}`);
  const { original, preview } = await uploadToImgbb({ apiKey: imgbbKey, imagePath });
  console.log(`🔗 公開URL: ${original}`);

  console.log(`📤 LINEへ画像を送信中 → friendId=${to}`);
  await pushLineImage({ token: lineToken, to, original, preview, caption });
  console.log('✅ LINEに画像を送信しました。');
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
