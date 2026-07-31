#!/usr/bin/env node
// =============================================================
// AIオフィス LINE成果物送信ツール（send-line-media.mjs）
// ローカルの画像・動画ファイルを LINE のトークに"実物"として送る部品。
//
// ファイル種別を拡張子で自動判定して送信形式を切り替える：
//   画像（.png/.jpg/.gif/.webp）
//     → R2 アップロード → LINE 画像メッセージ
//   動画（.mp4/.mov/.webm/.m4v）
//     → R2 アップロード + ffmpeg でサムネイル生成 → LINE 動画メッセージ
//   その他
//     → エラー終了（open コマンド付きテキスト報告にフォールバック）
//
// 使い方:
//   node send-line-media.mjs --file <成果物の絶対パス> --to <friendId>
//   node send-line-media.mjs --file ./video.mp4 --to <friendId> --caption "完成しました！"
//   node send-line-media.mjs <ファイルパス> <friendId>    # 位置引数でもOK
//
// 必要な認証情報（秘密情報。コミット禁止・環境変数か鍵ファイルで渡す）:
//   LINE_HARNESS_API_URL … line-harness Worker の URL
//   LINE_HARNESS_API_KEY … line-harness Admin API キー
//   読み込み順: 環境変数 → $OFFICE_HOME/.line-harness-key ファイル
//
// bridge 経由で spawn された社員セッションでは bridge plist から自動で引き継がれる。
// =============================================================

import { readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// ファイル種別テーブル
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
};

// 書類・ファイル系（LINEには画像/動画のような実体では送れないため、R2にアップして
// 「タップで開けるダウンロードリンク」をテキストで送る）
const DOC_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
};

function detectFileType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_TYPES[ext]) return { kind: 'image', mime: IMAGE_TYPES[ext] };
  if (VIDEO_TYPES[ext]) return { kind: 'video', mime: VIDEO_TYPES[ext] };
  if (DOC_TYPES[ext]) return { kind: 'file', mime: DOC_TYPES[ext] };
  // 未知の拡張子も「ファイル」として扱う（動画分岐に落として ffmpeg で壊れるのを防ぐ）
  return { kind: 'file', mime: 'application/octet-stream' };
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

// --- R2 アップロード → 公開 URL を返す ---------------------------------------
async function uploadToR2({ apiUrl, apiKey, filePath, mime }) {
  const buf = await readFile(filePath);

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
  if (res.status === 401) throw new Error('R2 認証エラー（401）。LINE_HARNESS_API_KEY を確認してください。');
  if (!res.ok) throw new Error(`R2 アップロード失敗（${res.status}）: ${text.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`R2 応答不正: ${text.slice(0, 200)}`); }

  const url = json?.data?.url || json?.url;
  if (!url) throw new Error(`R2 URL 取得失敗: ${text.slice(0, 200)}`);
  return url;
}

// --- ffmpeg で動画の先頭フレームをサムネイルとして抽出 ----------------------
async function extractThumbnail(videoPath) {
  const thumbPath = join(tmpdir(), `line-thumb-${randomUUID()}.jpg`);
  try {
    // 1秒目のフレームを試み、失敗したら最初のフレームを使う
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', videoPath, '-ss', '1', '-frames:v', '1', '-q:v', '3', thumbPath]);
    } catch {
      await execFileAsync('ffmpeg', ['-y', '-i', videoPath, '-frames:v', '1', '-q:v', '3', thumbPath]);
    }
    return thumbPath;
  } catch (e) {
    throw new Error(`サムネイル抽出失敗（ffmpeg）: ${e.message}`);
  }
}

// --- line-harness API 経由でメッセージ送信 ------------------------------------
async function sendViaHarness({ apiUrl, apiKey, friendId, messageType, content, caption }) {
  const send = async (type, cnt) => {
    const res = await fetch(`${apiUrl}/api/friends/${encodeURIComponent(friendId)}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'line-harness-mcp/1.0',
      },
      body: JSON.stringify({ messageType: type, content: cnt }),
    });
    const text = await res.text();
    if (res.status === 401) throw new Error('LINE_HARNESS_API_KEY 認証エラー（401）');
    if (res.status === 404) throw new Error(`friendId が見つかりません（404）: ${friendId}`);
    if (!res.ok) throw new Error(`LINE 送信失敗（${res.status}）: ${text.slice(0, 300)}`);
  };

  if (caption) await send('text', caption);
  await send(messageType, content);
}

// --- メイン ------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('使い方: node send-line-media.mjs --file <ファイルパス> --to <friendId> [--caption "文"]');
    console.log('        node send-line-media.mjs <ファイルパス> <friendId>');
    console.log('対応形式: 画像（.png/.jpg/.gif/.webp）／動画（.mp4/.mov/.webm/.m4v）');
    process.exit(0);
  }

  const filePath = (typeof args.file === 'string') ? args.file
                 : (typeof args.image === 'string') ? args.image  // 後方互換
                 : args._[0];
  const to = (typeof args.to === 'string') ? args.to : args._[1];
  const caption = (typeof args.caption === 'string') ? args.caption : null;

  if (!filePath) { console.error('❌ ファイルパスが必要です（--file <path> か 第1引数）。'); process.exit(2); }
  if (!existsSync(filePath)) { console.error(`❌ ファイルが見つかりません: ${filePath}`); process.exit(2); }
  if (!to) { console.error('❌ 送信先 friendId が必要です（--to <friendId> か 第2引数）。'); process.exit(2); }

  const { kind, mime } = detectFileType(filePath);
  if (kind === 'other') {
    console.error(`❌ 非対応ファイル形式です（${extname(filePath)}）。`);
    console.error('   対応: 画像（.png/.jpg/.gif/.webp）／動画（.mp4/.mov/.webm/.m4v）');
    console.error(`   手動で確認: open "${filePath}"`);
    process.exit(2);
  }

  const { apiUrl, apiKey } = await resolveHarnessCredentials();
  if (!apiUrl || !apiKey) {
    console.error('❌ LINE_HARNESS_API_URL または LINE_HARNESS_API_KEY が未設定です。');
    console.error('   環境変数か $OFFICE_HOME/.line-harness-key に設定してください。');
    process.exit(2);
  }

  if (kind === 'image') {
    console.log(`⬆️  R2 へアップロード中（画像）: ${filePath}`);
    const imageUrl = await uploadToR2({ apiUrl, apiKey, filePath, mime });
    console.log(`🔗 公開URL: ${imageUrl}`);

    console.log(`📤 LINE へ画像メッセージを送信中 → friendId=${to}`);
    const content = JSON.stringify({ originalContentUrl: imageUrl, previewImageUrl: imageUrl });
    await sendViaHarness({ apiUrl, apiKey, friendId: to, messageType: 'image', content, caption });
    console.log('✅ LINE に画像を送信しました。');

  } else if (kind === 'video') {
    console.log(`⬆️  R2 へアップロード中（動画 ${mime}）: ${filePath}`);
    const videoUrl = await uploadToR2({ apiUrl, apiKey, filePath, mime });
    console.log(`🔗 動画URL: ${videoUrl}`);

    console.log('🎞️  ffmpeg でサムネイルを生成中...');
    const thumbPath = await extractThumbnail(filePath);
    try {
      console.log(`⬆️  R2 へサムネイルをアップロード中: ${thumbPath}`);
      const thumbUrl = await uploadToR2({ apiUrl, apiKey, filePath: thumbPath, mime: 'image/jpeg' });
      console.log(`🔗 サムネURL: ${thumbUrl}`);

      console.log(`📤 LINE へ動画メッセージを送信中 → friendId=${to}`);
      const content = JSON.stringify({ originalContentUrl: videoUrl, previewImageUrl: thumbUrl });
      await sendViaHarness({ apiUrl, apiKey, friendId: to, messageType: 'video', content, caption });
      console.log('✅ LINE に動画を送信しました。');
    } finally {
      await unlink(thumbPath).catch(() => {});
    }

  } else {
    // 書類・その他ファイル（PDF/PowerPoint/ZIP等）
    // LINEには実体として送れないので、R2へアップして「タップで開けるリンク」をテキストで届ける。
    // ＝お客さんは自分のMacやフォルダを触らずに、スマホのLINEから成果物を受け取れる。
    console.log(`⬆️  R2 へアップロード中（ファイル ${mime}）: ${filePath}`);
    const fileUrl = await uploadToR2({ apiUrl, apiKey, filePath, mime });
    console.log(`🔗 ダウンロードURL: ${fileUrl}`);

    const name = basename(filePath);
    const head = caption ? `${caption}\n\n` : '';
    const text = `${head}📄 ${name}\n▼ タップで開く・保存できます\n${fileUrl}`;
    console.log(`📤 LINE へファイルのリンクを送信中 → friendId=${to}`);
    // caption は本文に折り込み済みなので二重送信しない（caption 引数は渡さない）
    await sendViaHarness({ apiUrl, apiKey, friendId: to, messageType: 'text', content: text });
    console.log('✅ LINE にファイルのリンクを送信しました。');
  }
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
