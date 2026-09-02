// =============================================================
//  設定ロード（環境変数 ＋ board.config.json）
//  依存ゼロ。.env があれば読み込む（node --env-file なしでも動く）。
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- .env を素朴に読む（KEY=VALUE、# はコメント、既存の環境変数は上書きしない） ---
function loadDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    // 前後のクォートを外す
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// --- board.config.json ---
const boardConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', 'board.config.json'), 'utf8')
);

// --- 必須チェックのヘルパ ---
function req(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`環境変数 ${name} が未設定です。.env を確認してください（.env.example を参照）。`);
  }
  return v.trim();
}

export const ROOT_DIR = ROOT;
export const BOARD = boardConfig;

export const CONFIG = {
  port: parseInt(process.env.PORT || '18790', 10),

  // LINE Messaging API
  lineChannelSecret: () => req('LINE_CHANNEL_SECRET'),
  lineChannelToken: () => req('LINE_CHANNEL_ACCESS_TOKEN'),

  // 先回り通知の送り先（グループID or ユーザーID）。未設定なら通知は送らない。
  notifyTarget: process.env.NOTIFY_TARGET || '',

  // Anthropic API（本番の解釈エンジン＝Claude）
  anthropicKey: () => req('ANTHROPIC_API_KEY'),
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',

  // Google Sheets（サービスアカウント）
  sheetId: () => req('GOOGLE_SHEET_ID'),
  googleClientEmail: () => req('GOOGLE_CLIENT_EMAIL'),
  // 秘密鍵は .env に \n エスケープで入る想定なので実改行へ戻す
  googlePrivateKey: () => req('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),

  // シートのタブ名（環境変数で上書き可）
  sheetTab: process.env.SHEET_TAB || boardConfig.sheet.tabName,
};
