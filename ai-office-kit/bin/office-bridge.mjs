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
// 信頼性ハードニングのしきい値（office.conf から注入・既定で妥当に動く）
const MAPPING_REFRESH_MIN = parseInt(process.env.MAPPING_REFRESH_MIN || '10', 10); // アカウントマッピング定期リフレッシュ間隔（分）
const SPAWN_TIMEOUT_MIN = parseInt(process.env.SPAWN_TIMEOUT_MIN || '8', 10);       // spawn がハングした時に kill するまでの分数

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

let mappingConfigured = false;    // line-harness 認証情報が設定されているか
let lastMappingRefetchAt = 0;     // 未知UUID着信時の即時再取得のスロットル用

// 戻り値: 取得件数（>=0）／ creds未設定は -2 ／ 取得失敗は -1
async function buildAccountMapping() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey || apiKey === 'XXXXXXXXXXXXXXXX') { mappingConfigured = false; return -2; }
  mappingConfigured = true;
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
    return Object.keys(mapping).length;
  } catch (e) {
    console.error('[bridge] アカウントマッピング取得失敗:', e.message);
    return -1;
  }
}

// 起動時：取得できるまで指数バックオフでリトライ（API一時不調で「全社員沈黙」になるのを防ぐ）
async function ensureMappingWithRetry() {
  const delays = [0, 3000, 8000, 20000, 45000];
  for (const d of delays) {
    if (d) await new Promise((r) => setTimeout(r, d));
    const n = await buildAccountMapping();
    if (n === -2) return;   // creds未設定＝レガシー形式運用。マッピング不要
    if (n > 0) return;      // 取得できた
    console.error('[bridge] マッピングが空/失敗。再取得します…');
  }
  console.error('[bridge] 起動時のマッピング取得に失敗（以後の定期リフレッシュ/着信時再取得に委ねます）');
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
// spawn した claude が「ログイン切れ(401)」「利用上限」で即死しても、Claude自身は認証切れ等で
// 何も返せず沈黙する。bridge（Claude認証に非依存）がログから検知し、①送信者へ一次応答
// ②オーナーへ復旧アクションを通知（重複抑制）する。通知は line-notify.mjs（Claude不要）で行う。
const AUTH_ERROR_RE = /Please run \/login|OAuth access token has expired|Invalid authentication credentials|Re-authenticate to continue/i;
// 利用上限は誤検知を避けるため保守的な文言のみ（Claude Code の実表示・API 429 の代表的文言）
const USAGE_LIMIT_RE = /usage limit reached|Claude usage limit|limit will reset at|rate limit|Too Many Requests/i;
const NOTIFY_BIN = path.join(OFFICE_HOME, 'bin', 'line-notify.mjs');
const AUTH_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 同種のオーナー通知は10分に1回まで（連投抑制）
const ownerAlertAt = {};                        // key -> 最終通知時刻

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

// オーナーへ種別ごとに重複抑制して通知
function maybeAlertOwner(key, text) {
  const owner = process.env.OWNER_FRIEND_ID;
  if (!owner || owner === '(オーナーのfriendId)') return;
  const now = Date.now();
  if (now - (ownerAlertAt[key] || 0) < AUTH_ALERT_COOLDOWN_MS) return;
  ownerAlertAt[key] = now;
  notifyLineText(owner, text);
}

// spawn ログの末尾を見て、ログイン切れ／利用上限なら通知する
function handleSpawnFailure(logPath, friendId) {
  let tail = '';
  try {
    tail = fs.readFileSync(logPath, 'utf8').slice(-4000);
  } catch { return; }

  if (AUTH_ERROR_RE.test(tail)) {
    console.error('[bridge] ⚠ Claudeログイン切れを検知（401）。LINE通知を送ります。');
    notifyLineText(friendId, 'ただいま一時的に応答できない状態です🙏 担当が確認して折り返しますので、少々お待ちください。');
    maybeAlertOwner('auth', '⚠️ AI社員のログイン(認証)が切れています。Macで Claude Code を開き /login で再ログインしてください。それまで全社員が応答できません。');
    return;
  }
  if (USAGE_LIMIT_RE.test(tail)) {
    console.error('[bridge] ⚠ Claude利用上限を検知。LINE通知を送ります。');
    notifyLineText(friendId, 'ただいま混み合っており応答が難しい状態です🙏 少し時間をおいて再度お試しください。担当も確認します。');
    maybeAlertOwner('usage', '⚠️ Claudeの利用上限に達しています。リセットまで待つか、上位プランをご検討ください。それまでAI社員の応答が不安定になります。');
    return;
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

  // ハング対策：一定時間で終了しなければ kill してロックを解放（社員が永久沈黙するのを防ぐ）
  const killTimer = setTimeout(() => {
    console.error(`[SPAWN] ${lineAccountId} が ${SPAWN_TIMEOUT_MIN}分応答せず。ハング疑いで停止します。`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    spawnLocks.delete(lineAccountId);
    try { fs.closeSync(logFd); } catch {}
    maybeAlertOwner('spawn-timeout', `⚠️ AI社員(${lineAccountId})の処理が${SPAWN_TIMEOUT_MIN}分応答せず停止しました。必要ならもう一度LINEで依頼してください。改善しなければMacで bridge の再起動を。`);
  }, SPAWN_TIMEOUT_MIN * 60 * 1000);

  child.on('exit', (code) => {
    clearTimeout(killTimer);
    console.log(`[SPAWN] ${lineAccountId} は終了コード ${code} で終了`);
    spawnLocks.delete(lineAccountId);
    try { fs.closeSync(logFd); } catch {}
    // ログイン切れ(401)／利用上限で即死していないかを確認し、必要ならLINE通知
    handleSpawnFailure(logPath, friendId);
  });
  child.on('error', (err) => {
    clearTimeout(killTimer);
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
        if (!lineAccountId && mappingConfigured) {
          // マッピングが古い可能性 → 30秒に1回まで即時再取得して解決を試みる
          const now = Date.now();
          if (now - lastMappingRefetchAt > 30000) {
            lastMappingRefetchAt = now;
            console.log(`[bridge] 未知UUID=${uuidAccountId}。マッピングを即時再取得します。`);
            await buildAccountMapping();
            lineAccountId = accountIdToMemberDir[uuidAccountId];
          }
        }
        if (!lineAccountId) {
          console.log(`[bridge] 未登録アカウント UUID=${uuidAccountId}、スキップ`);
          // マッピングが空＝API不調で全滅が疑われる時だけオーナー通知（本当に未登録channelなら誤報しない）
          if (mappingConfigured && Object.keys(accountIdToMemberDir).length === 0) {
            maybeAlertOwner('mapping', '⚠️ AIオフィスがアカウント情報を取得できていません（line-harness API不調の可能性）。LINE着信に応答できない状態です。Macで bridge のログ確認、または再起動をお願いします。');
          }
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
  // 起動後に line-harness アカウントマッピングを取得（取れるまでリトライ）
  ensureMappingWithRetry();
  // 定期リフレッシュ（新チャネル追加や一時不調からの自動復帰）
  if (MAPPING_REFRESH_MIN > 0) {
    setInterval(() => {
      if (mappingConfigured || process.env.LINE_HARNESS_API_URL) buildAccountMapping();
    }, MAPPING_REFRESH_MIN * 60 * 1000).unref?.();
  }
});
