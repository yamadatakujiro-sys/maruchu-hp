// =============================================================
//  LINE AIオフィス — office-bridge（push型起動の心臓部）
//
//  役割: line-harness から POST /webhook を受け、該当社員の
//        Claude セッションを即 spawn する（同時起動ロックあり）。
//
//  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
//    OFFICE_HOME      … オフィス本体の基準パス（必須）
//    PORT             … 待受ポート（既定 18789）
//    CLAUDE_BIN       … claude 実行ファイル（既定 'claude'）
//    MCP_NAME         … line-harness MCP のサーバ名（既定 'line-harness'）
//    LEADER_ID        … リーダーの lineAccountId（既定 'member-leader'）
//    OWNER_FRIEND_ID  … オーナーの friendId（プロンプト注意書きに使用・任意）
// =============================================================
import http from 'node:http';
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

// 同時起動防止用ロック（社員単位）
const spawnLocks = new Set();

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
      const { lineAccountId, message, friendId } = payload;

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
});
