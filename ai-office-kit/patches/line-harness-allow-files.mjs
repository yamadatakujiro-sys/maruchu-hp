#!/usr/bin/env node
// =============================================================================
//  line-harness Worker パッチ：書類ファイル（PDF/パワポ/Excel/ZIP等）を
//  アップロード＆ダウンロード配信できるようにする
//
//  なぜ必要か：
//    line-harness の POST /api/images は allowedTypes が画像・動画のみで、
//    PDF等の書類を弾く。そのため顧客に「編集できる元ファイル」を渡す手段が
//    `open <パス>`（オーナーのMacでしか開けない）しか無く、オーナーが在席して
//    手渡すしか無かった＝運用が破綻する。
//    このパッチで、AI社員が顧客のLINEへ「ダウンロードリンク」を自動送信できる。
//
//  対象ファイル（Mac上・git管理外）：
//    ~/.line-harness/apps/worker/src/routes/images.ts
//
//  使い方：
//    node line-harness-allow-files.mjs            … パッチ適用
//    node line-harness-allow-files.mjs --check    … 適用可能か確認するだけ
//    node line-harness-allow-files.mjs --restore  … バックアップから復元
//
//  ⚠️ 適用後は必ず正式ビルドでデプロイすること：
//      cd ~/.line-harness/apps/worker && npx vite build && npx wrangler deploy
//    （`wrangler deploy` 単独は TS 未コンパイルで重大事故。RUNBOOK.md §6 参照）
// =============================================================================
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.env.IMAGES_TS
  || join(homedir(), '.line-harness', 'apps', 'worker', 'src', 'routes', 'images.ts');
const BACKUP = `${TARGET}.bak-before-files-patch`;

const mode = process.argv[2] || '';
const log = (m) => console.log(m);
const ok = (m) => console.log(`  \x1b[1;32m✓\x1b[0m ${m}`);
const err = (m) => console.error(`  \x1b[1;31m✗ ${m}\x1b[0m`);

if (!existsSync(TARGET)) {
  err(`対象ファイルが見つかりません: ${TARGET}`);
  err('IMAGES_TS 環境変数で場所を指定できます。');
  process.exit(1);
}

// --- 復元モード -------------------------------------------------------------
if (mode === '--restore') {
  if (!existsSync(BACKUP)) { err(`バックアップがありません: ${BACKUP}`); process.exit(1); }
  copyFileSync(BACKUP, TARGET);
  ok(`元に戻しました: ${TARGET}`);
  log('  ⚠️ 反映するには再デプロイが必要: npx vite build && npx wrangler deploy');
  process.exit(0);
}

let src = readFileSync(TARGET, 'utf8');
const original = src;

// 既に適用済みなら何もしない（何度実行しても安全）
if (src.includes('application/pdf')) {
  ok('このファイルは既にパッチ適用済みです（何もしませんでした）。');
  process.exit(0);
}

// --- 置換1：許可する種類に書類を追加 ----------------------------------------
const NEW_ALLOWED = `const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
      // 書類（顧客へ「編集できる元ファイル」をダウンロードリンクで渡すため）
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // docx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // xlsx
      'application/vnd.ms-powerpoint', 'application/msword', 'application/vnd.ms-excel',
      'application/zip', 'text/csv', 'text/plain', 'text/markdown',
    ];`;

// --- 置換2：拡張子マップに書類を追加 ----------------------------------------
// （既定は mimeType.split('/')[1] のため、pptx等が長大な文字列になってしまう）
const NEW_EXTMAP = `const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt', 'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'text/plain': 'txt', 'text/markdown': 'md',
    };`;

// --- 置換3：バイナリ送信時も元ファイル名を受け取る ---------------------------
const NEW_BINARY = `mimeType = contentType.split(';')[0] || 'image/png';
      // 元のファイル名（?filename=... で渡される）。日本語名のまま保存できるようにする。
      filename = c.req.query('filename') || undefined;`;

// --- 置換4：書類はダウンロードとして返す ------------------------------------
const NEW_HEADERS = `headers.set('ETag', object.etag);

  // 画像・動画以外（PDF・パワポ等の書類）は「元のファイル名で保存できる」形で返す。
  // 顧客がスマホでリンクをタップした時に、そのまま開ける／保存できるようにするため。
  const ct = object.httpMetadata?.contentType || '';
  if (!ct.startsWith('image/') && !ct.startsWith('video/')) {
    const name = object.customMetadata?.originalFilename || key;
    const disposition = ct === 'application/pdf' ? 'inline' : 'attachment';
    headers.set('Content-Disposition', \`\${disposition}; filename*=UTF-8''\${encodeURIComponent(name)}\`);
  }`;

const edits = [
  { name: '許可する種類に書類を追加',        re: /const allowedTypes = \[[\s\S]*?\];/,                  to: NEW_ALLOWED },
  { name: '拡張子マップに書類を追加',        re: /const extMap: Record<string, string> = \{[\s\S]*?\};/, to: NEW_EXTMAP },
  { name: '元ファイル名を受け取る',          re: /mimeType = contentType\.split\(';'\)\[0\] \|\| 'image\/png';/, to: NEW_BINARY },
  { name: '書類をダウンロードとして返す',    re: /headers\.set\('ETag', object\.etag\);/,               to: NEW_HEADERS },
];

log(`\n[patch] 対象: ${TARGET}\n`);

const failed = [];
for (const e of edits) {
  const m = src.match(e.re);
  if (!m) { failed.push(e.name); err(`${e.name} … 該当箇所が見つかりません`); continue; }
  if (src.split(e.re).length > 2) { /* 複数一致でも先頭のみ置換（replaceの既定） */ }
  src = src.replace(e.re, e.to);
  ok(e.name);
}

if (failed.length) {
  err(`\n${failed.length}件の置換に失敗したため、ファイルは変更していません。`);
  err('line-harness のバージョン差の可能性があります。手作業で当てるか、開発者に相談してください。');
  process.exit(2);
}

if (mode === '--check') {
  ok('\n全ての置換が適用可能です（--check のため書き込みはしていません）。');
  process.exit(0);
}

// --- 書き込み（バックアップを先に取る）--------------------------------------
if (!existsSync(BACKUP)) copyFileSync(TARGET, BACKUP);
writeFileSync(TARGET, src, 'utf8');

log('');
ok(`パッチを適用しました（バックアップ: ${BACKUP}）`);
log('');
log('  次にやること（このコマンドをそのまま実行）:');
log('    cd ~/.line-harness/apps/worker && npx vite build && npx wrangler deploy');
log('');
log('  ⚠️ `wrangler deploy` 単独は厳禁（TS未コンパイルで全メッセージ無視の重大事故）');
log('  ↩ 元に戻す: node line-harness-allow-files.mjs --restore');
log('');
void original;
