// =============================================================
//  LINE AIオフィス — office-bridge（push型起動の心臓部）
//
//  役割: line-harness から POST /webhook を受け、該当社員の
//        Claude セッションを即 spawn する（同時起動ロックあり）。
//
//  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
//    OFFICE_HOME           … オフィス本体の基準パス（必須）
//    PORT                  … 待受ポート（既定 18789）
//    CLAUDE_BIN            … claude 実行ファイル（既定 'claude'）
//    MCP_NAME              … line-harness MCP のサーバ名（既定 'line-harness'）
//    LEADER_ID             … リーダーの lineAccountId（既定 'member-leader'）
//    OWNER_FRIEND_ID       … オーナーの friendId（プロンプト注意書きに使用・任意）
//    LINE_HARNESS_API_URL  … line-harness Worker の URL（UUID→メンバー解決に使用）
//    LINE_HARNESS_API_KEY  … line-harness Admin API キー（同上）
//                            ※ install.sh が生成する bridge.plist に手動で追記が必要。
//                              ~/.mcp.json の line-harness エントリから値を確認できる。
//
// 【Worker側変更メモ（2026-07-17 適用）】
//  line-harness の services/event-bus.ts を修正し、outgoing webhook ペイロードに
//  lineAccountId（チャネル UUID）を含めてデプロイ済み。
//  変更箇所: fireOutgoingWebhooks() のシグネチャに lineAccountId? を追加し、
//  JSON body のトップレベルに lineAccountId フィールドを出力するよう変更。
//  送信される outgoing webhook ペイロード形式:
//    { event, timestamp, lineAccountId: "<channel-UUID>",
//      data: { friendId, eventData: { text, matched, ... } } }
// =============================================================
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// --- 設定（環境変数から） ------------------------------------
const OFFICE_HOME = process.env.OFFICE_HOME;
if (!OFFICE_HOME) {
  console.error('[office-bridge] OFFICE_HOME が未設定です。office.conf を確認してください。');
  process.exit(1);
}
const PORT = parseInt(process.env.PORT || '18789', 10);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MCP_NAME = process.env.MCP_NAME || 'line-harness';
const LEADER_ID = process.env.LEADER_ID || 'member-leader';
const OWNER_FRIEND_ID = process.env.OWNER_FRIEND_ID || '(オーナーのfriendId)';

const MEMBERS_DIR = path.join(OFFICE_HOME, 'members');
const INBOX_DIR = path.join(OFFICE_HOME, 'line-bridge', 'inbox');
const LOG_DIR = path.join(OFFICE_HOME, 'logs');

// 必要なディレクトリを用意
fs.mkdirSync(INBOX_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// line-harness の accountId(UUID) → member-<displayName> マッピング
// 起動時に /api/line-accounts から取得してキャッシュする
let accountIdToMemberDir = {};

async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

async function buildAccountMapping() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey || apiKey === 'XXXXXXXXXXXXXXXX') return;
  try {
    const res = await fetchJson(`${apiUrl}/api/line-accounts`, {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'line-harness-mcp/1.0',
    });
    const mapping = {};
    for (const acct of (res.data || [])) {
      const dir = `member-${acct.displayName}`;
      if (fs.existsSync(path.join(MEMBERS_DIR, dir))) {
        mapping[acct.id] = dir;
      }
    }
    accountIdToMemberDir = mapping;
    console.log(`[bridge] アカウントマッピング取得: ${Object.keys(mapping).length}件`);
  } catch (e) {
    console.error('[bridge] アカウントマッピング取得失敗:', e.message);
  }
}

// 同時起動防止用ロック（社員単位）
const spawnLocks = new Set();

// =============================================================
//  Claude ログイン切れ（認証失効）検知＋LINE通知
//
//  push型では LINE着信で claude を spawn するが、Claude Code のログイン(OAuth)が
//  切れていると spawn した claude が 401 で即死し、**AI社員は何も返せず完全に沈黙**する
//  （Claude自身が認証切れなので「ログイン切れ」とすら言えない）。
//  そこで bridge（＝Node製・Claude認証に非依存）が spawn ログから 401 を検知し、
//   ①送信者へ「少々お待ちください」を自動返信（顧客を沈黙させない）
//   ②オーナーへ「Macで /login して」を通知（重複抑制つき）
//  を line-notify.mjs（Claude不要のLINE送信部品）で行う。
// =============================================================
const AUTH_ERROR_RE = /Please run \/login|OAuth access token has expired|Invalid authentication credentials|Re-authenticate to continue/i;
const NOTIFY_BIN = path.join(OFFICE_HOME, 'bin', 'line-notify.mjs');
const AUTH_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // オーナー通知は10分に1回まで（連投抑制）
let lastAuthAlertAt = 0;

// line-notify.mjs を叩いてLINEテキストを送る（fire and forget・失敗しても bridge は落とさない）
function notifyLineText(friendId, text) {
  if (!friendId) return;
  try {
    const child = spawn(process.execPath, [NOTIFY_BIN, '--to', friendId, text], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', (e) => console.error('[bridge] line-notify 起動失敗:', e.message));
    child.unref();
  } catch (e) {
    console.error('[bridge] line-notify 例外:', e.message);
  }
}

// spawn ログの末尾を見て認証切れなら通知する
function handlePossibleAuthFailure(logPath, friendId) {
  let tail = '';
  try {
    tail = fs.readFileSync(logPath, 'utf8').slice(-4000);
  } catch { return; }
  if (!AUTH_ERROR_RE.test(tail)) return;

  console.error('[bridge] ⚠ Claudeログイン切れを検知（401）。LINE通知を送ります。');
  // ①送信者を沈黙させない（オーナー本人でも顧客でも）
  notifyLineText(friendId, 'ただいま一時的に応答できない状態です🙏 担当が確認して折り返しますので、少々お待ちください。');
  // ②オーナーへ復旧アクションを通知（重複抑制）
  const owner = process.env.OWNER_FRIEND_ID;
  const now = Date.now();
  if (now - lastAuthAlertAt > AUTH_ALERT_COOLDOWN_MS) {
    lastAuthAlertAt = now;
    if (owner && owner !== friendId) {
      notifyLineText(owner, '⚠️ AI社員のログイン(認証)が切れています。Macで Claude Code を開き /login で再ログインしてください。それまで全社員が応答できません。');
    } else if (friendId) {
      // オーナー自身が送信者だった場合は復旧アクションを直接伝える
      notifyLineText(friendId, '⚠️ ログイン(認証)が切れています。Macで Claude Code を開き /login で再ログインしてください。');
    }
  }
}

// lineAccountId から社員ディレクトリを解決する。
// このキットでは members/<lineAccountId> が社員ディレクトリ（例: members/member-lp）。
function resolveMemberDir(lineAccountId) {
  const cwd = path.join(MEMBERS_DIR, lineAccountId);
  return fs.existsSync(cwd) ? cwd : null;
}

function triggerClaudeSession(lineAccountId, message, friendId) {
  const cwd = resolveMemberDir(lineAccountId);
  if (!cwd) {
    console.log(`[SPAWN] 社員ディレクトリが見つかりません: ${lineAccountId}（${path.join(MEMBERS_DIR, lineAccountId)}）`);
    return;
  }
  if (spawnLocks.has(lineAccountId)) {
    console.log(`[SPAWN] ${lineAccountId} は起動中のためスキップ`);
    return;
  }

  const isLeader = lineAccountId === LEADER_ID;
  const nonLeaderRestrictions = isLeader ? '' : `

**【最重要：このセッションは実作業禁止】**
あなたは push型の自動spawnで起動された軽量セッションです。以下を守ってください：
- 実作業（成果物生成・画像生成・LP/バナー制作・projects/配下のファイル作成等）は一切しない
- やるのは「文脈把握」「ヒアリング質問送信」「task.md/task_asked.md の更新」「オーナーにターミナルを開いてもらうよう依頼」のみ
- 実作業はオーナーがターミナルで \`cd ${cwd} && ${CLAUDE_BIN}\` を開いた時にやる
- 迷ったら作業せずにオーナーにLINEで確認
`;

  const prompt = `LINEで新着メッセージを受信しました：

「${message}」

以下を実行してください：
1. mcp__${MCP_NAME}__get_ai_conversations(lineAccountId: "${lineAccountId}", limit: 10) で文脈を確認
2. 自分の CLAUDE.md の記載手順に従って対応
3. 必要なLINE返信は必ず自分のアカウントから送信すること：
   mcp__${MCP_NAME}__send_message(accountId: "${lineAccountId}", friendId: "${friendId}", content: "...")

**重要：friendId は必ず "${friendId}" を使うこと。**「${OWNER_FRIEND_ID}」等の別IDを使うと他アカウントから送信されてしまう。

**MCP失敗時のリトライ方針（重要）：**
mcp__${MCP_NAME}__send_message や他のmcpツールが "Internal Server Error" 等のエラーを返した場合：
- **3回まで自動リトライする**（各リトライ間は5秒待機）
- 3回失敗したら、最後の試行の詳細エラーをこのセッションのサマリに残す
- 復旧後に再実行できるよう、送信しようとしていた内容を記録する
- 絶対に「LINE送信できなかったので諦めます」で終わらない
${nonLeaderRestrictions}
オーナーからのメッセージです。`;

  spawnLocks.add(lineAccountId);
  console.log(`[SPAWN] ${lineAccountId} の claude を起動: ${cwd}`);

  const logPath = path.join(LOG_DIR, `spawn-${lineAccountId}.log`);
  const logFd = fs.openSync(logPath, 'a');
  fs.writeSync(logFd, `\n=== ${new Date().toISOString()} ===\n`);

  // 不正なプレースホルダーAPIキーを除外（OAuthにフォールバックさせる）
  const cleanEnv = { ...process.env };
  delete cleanEnv.ANTHROPIC_API_KEY;

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    '--permission-mode', 'bypassPermissions',
  ], {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: cleanEnv,
  });

  child.on('exit', (code) => {
    console.log(`[SPAWN] ${lineAccountId} は終了コード ${code} で終了`);
    spawnLocks.delete(lineAccountId);
    try { fs.closeSync(logFd); } catch {}
    // ログイン切れ（401）で即死していないかを確認し、必要ならLINE通知
    handlePossibleAuthFailure(logPath, friendId);
  });
  child.on('error', (err) => {
    console.error(`[SPAWN] ${lineAccountId} エラー:`, err);
    spawnLocks.delete(lineAccountId);
    try { fs.closeSync(logFd); } catch {}
  });
  child.unref();
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // POST /webhook — line-harness からのメッセージ受信
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body);
      let lineAccountId, message, friendId;

      if (payload.event && payload.data) {
        // line-harness outgoing webhook 形式:
        // { event, timestamp, lineAccountId(UUID), data: { friendId, eventData: { text } } }
        const uuidAccountId = payload.lineAccountId;
        lineAccountId = accountIdToMemberDir[uuidAccountId];
        if (!lineAccountId) {
          console.log(`[bridge] 未登録アカウント UUID=${uuidAccountId}、スキップ`);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, skipped: true }));
          return;
        }
        message = payload.data?.eventData?.text;
        friendId = payload.data?.friendId;
      } else {
        // レガシー形式: { lineAccountId, message, friendId }
        ({ lineAccountId, message, friendId } = payload);
      }

      if (!lineAccountId || !message) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'lineAccountId and message required' }));
        return;
      }

      // 社員ごとのinboxファイルに書き込み
      const filepath = path.join(INBOX_DIR, `${lineAccountId}.json`);
      const entry = {
        lineAccountId,
        friendId,
        message,
        timestamp: new Date().toISOString(),
        processed: false,
      };
      fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));
      console.log(`[${new Date().toISOString()}] 受信 ${lineAccountId}: ${message.slice(0, 50)}...`);

      // Claude Code セッションを自動起動（fire and forget）
      triggerClaudeSession(lineAccountId, message, friendId);

      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      console.error('Parse error:', e);
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid json' }));
    }
    return;
  }

  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', inbox: INBOX_DIR }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LINE AIオフィス bridge 起動: http://127.0.0.1:${PORT}`);
  console.log(`Inbox: ${INBOX_DIR}`);
  // 起動後に line-harness アカウントマッピングを取得
  buildAccountMapping();
});
