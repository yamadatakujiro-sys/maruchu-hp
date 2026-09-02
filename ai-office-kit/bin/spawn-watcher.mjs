#!/usr/bin/env node
// =============================================================
//  LINE AIオフィス — spawn-watcher（poll型起動・見張り役）
//
//  役割: 各社員の inbox/task.md を検知したら task_doing.md にrenameし、
//        その担当の claude を自動起動する常駐デーモン（最大同時 MAX_CONCURRENT）。
//        報告は必ずリーダーのアカウントに【表示名】接頭辞で集約（司令室方式）。
//
//  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
//    OFFICE_HOME      … オフィス本体の基準パス（必須）
//    CLAUDE_BIN       … claude 実行ファイル（既定 'claude'）
//    MCP_NAME         … line-harness MCP のサーバ名（既定 'line-harness'）
//    POLL_MS          … 監視間隔ミリ秒（既定 5000）
//    MAX_CONCURRENT   … 同時起動上限（既定 3）
//    LEADER_ID        … リーダーの社員dir/アカウント（既定 'member-leader'）
//    OWNER_FRIEND_ID  … オーナーの friendId（任意・報告送信先の明示に使用）
//
//  社員一覧は OFFICE_HOME/office-members.json（install.sh が生成）を読む。
//  無ければ members/ 配下のディレクトリを走査する。
// =============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OFFICE_HOME = process.env.OFFICE_HOME;
if (!OFFICE_HOME) {
  console.error('[spawn-watcher] OFFICE_HOME が未設定です。office.conf を確認してください。');
  process.exit(1);
}
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MCP_NAME = process.env.MCP_NAME || 'line-harness';
const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);
const LEADER_ID = process.env.LEADER_ID || 'member-leader';
const OWNER_FRIEND_ID = process.env.OWNER_FRIEND_ID || '';
// 信頼性ハードニングのしきい値（office.conf から注入・既定で妥当に動く）
const SPAWN_TIMEOUT_MIN = parseInt(process.env.SPAWN_TIMEOUT_MIN || '8', 10);  // ハングとみなして kill するまでの分数
const STALE_DOING_MIN = parseInt(process.env.STALE_DOING_MIN || '10', 10);     // 孤立 task_doing.md を再キューするまでの分数
const MAX_TASK_RETRY = parseInt(process.env.MAX_TASK_RETRY || '2', 10);        // 同一タスクの自動再試行の上限
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;                                     // 環境要因(認証切れ等)失敗後の再試行待ち
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;                                      // 同種オーナー通知の連投抑制

const BASE = path.join(OFFICE_HOME, 'members');
const MANIFEST = path.join(OFFICE_HOME, 'office-members.json');
const LOG_DIR = path.join(OFFICE_HOME, 'logs');
const NOTIFY_BIN = path.join(OFFICE_HOME, 'bin', 'line-notify.mjs');

// spawn した claude が「ログイン切れ(401)」「利用上限」で即死しても沈黙する。委任経路でも検知して通知する。
const AUTH_ERROR_RE = /Please run \/login|OAuth access token has expired|Invalid authentication credentials|Re-authenticate to continue/i;
const USAGE_LIMIT_RE = /usage limit reached|Claude usage limit|limit will reset at|rate limit|Too Many Requests/i;

// --- LINE通知（Claude認証に非依存の line-notify.mjs を叩く。失敗しても watcher は落とさない）---
const ownerAlertAt = {};
function notifyLineText(friendId, text) {
  if (!friendId) return;
  try {
    const c = spawn(process.execPath, [NOTIFY_BIN, '--to', friendId, text], { detached: true, stdio: 'ignore', env: process.env });
    c.on('error', () => {});
    c.unref();
  } catch {}
}
function maybeAlertOwner(key, text) {
  if (!OWNER_FRIEND_ID) return;
  const now = Date.now();
  if (now - (ownerAlertAt[key] || 0) < ALERT_COOLDOWN_MS) return;
  ownerAlertAt[key] = now;
  notifyLineText(OWNER_FRIEND_ID, text);
}

// --- タスク再試行カウンタ（inbox/.task_retry の sidecar・再起動をまたいで無限リトライを防ぐ）---
function retryFile(dir) { return path.join(BASE, dir, 'inbox', '.task_retry'); }
function readRetry(dir) { try { return parseInt(fs.readFileSync(retryFile(dir), 'utf8'), 10) || 0; } catch { return 0; } }
function writeRetry(dir, n) { try { if (n <= 0) fs.rmSync(retryFile(dir), { force: true }); else fs.writeFileSync(retryFile(dir), String(n)); } catch {} }

// 社員ごとの再着手クールダウン（tight spin 防止）
const cooldownUntil = new Map();
function setCooldown(dir, ms) { cooldownUntil.set(dir, Date.now() + ms); }

// task_doing.md を task.md に戻す（新規 task.md が既にある時は二重処理を避けて done へ退避）
function requeue(dir, doingFile) {
  const taskFile = path.join(BASE, dir, 'inbox', 'task.md');
  try {
    if (!fs.existsSync(taskFile)) fs.renameSync(doingFile, taskFile);
    else fs.renameSync(doingFile, path.join(BASE, dir, 'inbox', 'done', `superseded-${Date.now()}.md`));
  } catch (e) { log(`requeue失敗 ${dir}: ${e.message}`); }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// --- 社員一覧の解決（マニフェスト優先・無ければディレクトリ走査）---
function loadMembers() {
  // 1) マニフェスト
  if (fs.existsSync(MANIFEST)) {
    try {
      const data = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      if (Array.isArray(data.members) && data.members.length > 0) {
        return data.members.map((m) => ({ dir: m.dir, name: m.name || m.dir }));
      }
    } catch (e) {
      log(`マニフェスト読込失敗（走査にフォールバック）: ${e.message}`);
    }
  }
  // 2) ディレクトリ走査（inbox を持つサブディレクトリを社員とみなす）
  if (!fs.existsSync(BASE)) return [];
  return fs.readdirSync(BASE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(BASE, d.name, 'inbox')))
    .map((d) => ({ dir: d.name, name: d.name }));
}

const MEMBERS = loadMembers();
if (MEMBERS.length === 0) {
  log('社員が見つかりません（members/ または office-members.json を確認）。');
}
const leaderName = (MEMBERS.find((m) => m.dir === LEADER_ID) || {}).name || 'リーダー';

let running = 0;
const inFlight = new Set();

// 完了書庫・ログ置き場を用意
fs.mkdirSync(LOG_DIR, { recursive: true });
for (const m of MEMBERS) {
  fs.mkdirSync(path.join(BASE, m.dir, 'inbox', 'done'), { recursive: true });
}

function buildEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  // CLAUDE_BIN のあるディレクトリを PATH 先頭に通す
  const binDir = path.dirname(CLAUDE_BIN);
  if (binDir && binDir !== '.') env.PATH = `${binDir}:${env.PATH || ''}`;
  return env;
}

function spawnMember(member) {
  const memberRoot = path.join(BASE, member.dir);
  const ownerNote = OWNER_FRIEND_ID
    ? `（オーナーの friendId は "${OWNER_FRIEND_ID}"）`
    : '（オーナーの friendId はリーダーの会話履歴から確認すること）';
  const prompt = [
    `あなたは「${member.name}」担当です。`,
    `inbox/task_doing.md に作業依頼が入っています。内容を読み、作業を最後まで完遂してください。`,
    `【着手の一報・最優先／省略厳禁】このセッションの「いちばん最初のツール呼び出し」として（task_doing.md を読み込むより前・他のどのツールより前に）、必ず mcp__${MCP_NAME}__send_message を1回実行し、リーダー（accountId: "${LEADER_ID}"／アカウント名: ${leaderName}）のルームに「【${member.name}】了解しました！すぐ着手します。完了したら報告します。」と送ってください${ownerNote}。これはオーナーに「チームが動き出した」ことを見せる重要な演出です。作業や成果物づくりを先に始めて一報を飛ばすことは固く禁止します。一報を送ってから作業に入ってください。`,
    `その後に作業を進めます。完了したら成果物を保存し、inbox/task_doing.md を inbox/done/ に移動してください。`,
    `【報告ルール】着手の一報も完了報告も、結果はすべて mcp__${MCP_NAME}__send_message で、必ずリーダー（accountId: "${LEADER_ID}"／アカウント名: ${leaderName}）のルームに送ってください${ownerNote}。メッセージの冒頭に必ず【${member.name}】を付けること。自分の担当アカウントには絶対に送らないでください（オーナーのトークルームを増やさないため、報告はすべてリーダーのルームに集約します）。`,
  ].join('\n');

  log(`▶ spawn: ${member.dir}`);
  running++;
  inFlight.add(member.dir);

  const doingFile = path.join(memberRoot, 'inbox', 'task_doing.md');
  // 子出力を社員別ログに取り込む（失敗＝ログイン切れ/利用上限の検知に使う）
  const logPath = path.join(LOG_DIR, `member-${member.dir}.log`);
  let logFd = null;
  try { logFd = fs.openSync(logPath, 'a'); fs.writeSync(logFd, `\n=== ${new Date().toISOString()} ${member.dir} ===\n`); } catch { logFd = null; }
  const outStdio = logFd !== null ? logFd : 'inherit';
  // 今回のセッション出力が始まるバイト位置。失敗判定はここ以降だけを見る（過去ログ誤検知の防止）。
  let sessionStart = 0;
  if (logFd !== null) { try { sessionStart = fs.fstatSync(logFd).size; } catch {} }

  const child = spawn(CLAUDE_BIN, ['-p', prompt, '--permission-mode', 'bypassPermissions'], {
    cwd: memberRoot,
    env: buildEnv(),
    detached: true,
    stdio: ['ignore', outStdio, outStdio],
  });

  // ハング対策：一定時間で終了しなければ kill（exit ハンドラが後始末＋再キューする）
  const killTimer = setTimeout(() => {
    log(`⏰ timeout: ${member.dir} を停止（${SPAWN_TIMEOUT_MIN}分）`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }, SPAWN_TIMEOUT_MIN * 60 * 1000);

  const finalize = (code) => {
    clearTimeout(killTimer);
    running--; inFlight.delete(member.dir);
    if (logFd !== null) { try { fs.closeSync(logFd); } catch {} }
    onSessionEnd(member.dir, doingFile, logPath, sessionStart);
    void code;
  };
  child.on('exit', (code) => { log(`■ done: ${member.dir} (exit ${code})`); finalize(code); });
  child.on('error', (err) => { log(`✖ error: ${member.dir} ${err.message}`); finalize(-1); });
  child.unref();
}

// セッション終了後の後始末：完了＝成功、未完了＝失敗種別に応じて再キュー/退避＋通知
function onSessionEnd(dir, doingFile, logPath, fromOffset = 0) {
  // 完了していれば担当が task_doing.md を done/ に移動済み → 成功
  if (!fs.existsSync(doingFile)) { writeRetry(dir, 0); return; }

  let tail = '';
  // fromOffset 以降＝今回のセッション出力のみをバイト単位で切り出す（過去ログの古いエラーで誤分類しない）
  try { const buf = fs.readFileSync(logPath); tail = buf.subarray(Math.min(fromOffset, buf.length)).toString('utf8'); } catch {}

  // 環境要因（ログイン切れ／利用上限）：リトライ数にカウントせず、クールダウン後に再試行＋オーナー通知
  if (AUTH_ERROR_RE.test(tail)) {
    log(`⚠ auth切れ検知: ${dir} → 再キュー＋通知`);
    maybeAlertOwner('auth', '⚠️ AI社員のログイン(認証)が切れています。Macで Claude Code を開き /login で再ログインしてください。委任タスクが進みません。');
    requeue(dir, doingFile); setCooldown(dir, FAILURE_COOLDOWN_MS); return;
  }
  if (USAGE_LIMIT_RE.test(tail)) {
    log(`⚠ 利用上限検知: ${dir} → 再キュー＋通知`);
    maybeAlertOwner('usage', '⚠️ Claudeの利用上限に達しています。リセットまで待つか、上位プランをご検討ください。');
    requeue(dir, doingFile); setCooldown(dir, FAILURE_COOLDOWN_MS); return;
  }

  // 一般的な失敗/クラッシュ/タイムアウト → 上限まで再キュー、超えたら task_failed.md へ退避＋通知
  const n = readRetry(dir) + 1;
  if (n <= MAX_TASK_RETRY) {
    writeRetry(dir, n);
    log(`↻ requeue ${dir}（${n}/${MAX_TASK_RETRY}）`);
    requeue(dir, doingFile); setCooldown(dir, 30000);
  } else {
    writeRetry(dir, 0);
    try { fs.renameSync(doingFile, path.join(BASE, dir, 'inbox', 'task_failed.md')); } catch {}
    maybeAlertOwner(`task-fail-${dir}`, `⚠️ AI社員(${dir})のタスクが${MAX_TASK_RETRY}回失敗しました。inbox/task_failed.md を確認してください。`);
  }
}

// 孤立 task_doing.md の復旧：クラッシュ/強制終了で残った古い task_doing.md を再キュー
// （これが無いと task_doing.md が残ったまま tick がスキップし続け、再起動しても永久に着手されない）
function recoverOrphans() {
  const staleMs = STALE_DOING_MIN * 60 * 1000;
  for (const m of MEMBERS) {
    if (inFlight.has(m.dir)) continue;
    const doingFile = path.join(BASE, m.dir, 'inbox', 'task_doing.md');
    if (!fs.existsSync(doingFile)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(doingFile).mtimeMs; } catch { continue; }
    if (Date.now() - mtime < staleMs) continue;
    const n = readRetry(m.dir) + 1;
    if (n <= MAX_TASK_RETRY) {
      writeRetry(m.dir, n);
      log(`🩹 孤立task_doing復旧 → 再キュー: ${m.dir}（${n}/${MAX_TASK_RETRY}）`);
      requeue(m.dir, doingFile);
    } else {
      writeRetry(m.dir, 0);
      try { fs.renameSync(doingFile, path.join(BASE, m.dir, 'inbox', 'task_failed.md')); } catch {}
      maybeAlertOwner(`task-fail-${m.dir}`, `⚠️ AI社員(${m.dir})の停滞タスクを復旧できませんでした。inbox/task_failed.md を確認してください。`);
    }
  }
}

function tick() {
  for (const m of MEMBERS) {
    if (running >= MAX_CONCURRENT) break;
    if (inFlight.has(m.dir)) continue;
    if ((cooldownUntil.get(m.dir) || 0) > Date.now()) continue;   // 失敗直後の再着手クールダウン中
    const inbox = path.join(BASE, m.dir, 'inbox');
    const taskFile = path.join(inbox, 'task.md');
    const doingFile = path.join(inbox, 'task_doing.md');
    if (!fs.existsSync(taskFile)) continue;
    if (fs.existsSync(doingFile)) continue;
    try {
      fs.renameSync(taskFile, doingFile);
    } catch (e) {
      log(`rename失敗 ${m.dir}: ${e.message}`);
      continue;
    }
    spawnMember(m);
  }
}

log('LINE AIオフィス 見張り役を起動しました 👀');
// 起動直後と定期に、孤立した task_doing.md を復旧（再起動をまたいだ恒久停止を防ぐ）
recoverOrphans();
setInterval(recoverOrphans, 60000).unref?.();
setInterval(tick, POLL_MS);
tick();
