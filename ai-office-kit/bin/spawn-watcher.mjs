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

const BASE = path.join(OFFICE_HOME, 'members');
const MANIFEST = path.join(OFFICE_HOME, 'office-members.json');

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

// 完了書庫を用意
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
    `完了したら成果物を保存し、inbox/task_doing.md を inbox/done/ に移動してください。`,
    `【報告ルール】結果は mcp__${MCP_NAME}__send_message で、必ずリーダー（accountId: "${LEADER_ID}"／アカウント名: ${leaderName}）のルームに送ってください${ownerNote}。メッセージの冒頭に必ず【${member.name}】を付けること。自分の担当アカウントには絶対に送らないでください（オーナーのトークルームを増やさないため、報告はすべてリーダーのルームに集約します）。`,
  ].join('\n');

  log(`▶ spawn: ${member.dir}`);
  running++;
  inFlight.add(member.dir);

  const child = spawn(CLAUDE_BIN, ['-p', prompt, '--permission-mode', 'bypassPermissions'], {
    cwd: memberRoot,
    env: buildEnv(),
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    running--; inFlight.delete(member.dir);
    log(`■ done: ${member.dir} (exit ${code})`);
  });
  child.on('error', (err) => {
    running--; inFlight.delete(member.dir);
    log(`✖ error: ${member.dir} ${err.message}`);
  });
}

function tick() {
  for (const m of MEMBERS) {
    if (running >= MAX_CONCURRENT) break;
    if (inFlight.has(m.dir)) continue;
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
setInterval(tick, POLL_MS);
tick();
