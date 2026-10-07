#!/usr/bin/env node
// =============================================================
//  オフライン通しテスト（ネット・鍵なし）
//  Google Sheets API と Claude を「偽物」に差し替えて、本番と同じコードで
//    ① ホワイトボードの組み立て → ② LINE操作（移動・入庫・担当・更新・予約・休み・納車）
//    → ③ 先回り通知
//  までを通しで動かし、セルの中身を検証する。
//  偽のSheetsは、範囲外への書き込み・結合の重なりなど本物がエラーにするものはエラーにする。
//
//  使い方:  node scripts/offline-e2e.mjs        （--show でボードを表示）
// =============================================================
import assert from 'node:assert';
import crypto from 'node:crypto';

const SHOW = process.argv.includes('--show');

// ---------- 環境（ダミーの鍵） ----------
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
Object.assign(process.env, {
  GOOGLE_KEY_FILE: '',
  GOOGLE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  GOOGLE_SHEET_ID: 'FAKE',
  ANTHROPIC_API_KEY: 'fake',
  LINE_CHANNEL_SECRET: 'x',
  LINE_CHANNEL_ACCESS_TOKEN: 'x',
  STAFF: '社長,松本,井上,林,清水,森,ゆうこ,あやか',
});

// ---------- 偽のスプレッドシート ----------
const colNum = (s) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
const sheets = new Map(); // title -> { id, rows, cols, cells: Map("r,c" -> value), merges: [] }
let nextId = 100;
function addTab(title, rows = 1000, cols = 26, index) {
  sheets.set(title, { id: nextId++, title, rows, cols, cells: new Map(), merges: [], index });
}
addTab('工程ボード', 1000, 26, 0); // 既存のタブ（触られないこと）
sheets.get('工程ボード').cells.set('0,0', '既存データ');
const byId = (id) => [...sheets.values()].find((s) => s.id === id);

function parseA1(range) {
  const m = range.match(/^(.+)!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  if (!m) throw new Error(`A1解析不可: ${range}`);
  const tab = sheets.get(m[1]);
  if (!tab) throw new Error(`タブがありません: ${m[1]}`);
  const c0 = colNum(m[2]);
  const r0 = m[3] ? +m[3] - 1 : 0;
  const c1 = m[4] ? colNum(m[4]) : c0;
  const r1 = m[5] ? +m[5] - 1 : (m[4] ? tab.rows - 1 : r0);
  return { tab, r0, r1, c0, c1 };
}
const warnings = [];
function inMergeNotAnchor(tab, r, c) {
  return tab.merges.some((g) => r >= g.r0 && r < g.r1 && c >= g.c0 && c < g.c1 && !(r === g.r0 && c === g.c0));
}
function writeRange(range, values) {
  const { tab, r0, c0 } = parseA1(range);
  values.forEach((row, i) => row.forEach((v, j) => {
    const r = r0 + i; const c = c0 + j;
    if (r >= tab.rows || c >= tab.cols) throw new Error(`範囲外への書き込み ${tab.title} r${r + 1} c${c + 1}`);
    let val = v === true ? 'TRUE' : v === false ? 'FALSE' : (v ?? '').toString();
    if (val.startsWith("'")) val = val.slice(1);        // USER_ENTERED の文字列指定
    if (val !== '' && inMergeNotAnchor(tab, r, c)) warnings.push(`結合セルの中に書き込み（見えない）: ${tab.title} ${range}`);
    if (val === '') tab.cells.delete(`${r},${c}`); else tab.cells.set(`${r},${c}`, val);
  }));
}
function readRange(range) {
  const { tab, r0, r1, c0, c1 } = parseA1(range);
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) row.push(tab.cells.get(`${r},${c}`) ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();   // 本物と同じく末尾の空は省略
    out.push(row);
  }
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}
function checkGrid(g, label) {
  const tab = byId(g.sheetId);
  if (!tab) throw new Error(`${label}: sheetId ${g.sheetId} がありません`);
  const ok = g.startRowIndex >= 0 && g.endRowIndex <= tab.rows && g.startColumnIndex >= 0 && g.endColumnIndex <= tab.cols
    && g.startRowIndex < g.endRowIndex && g.startColumnIndex < g.endColumnIndex;
  if (!ok) throw new Error(`${label}: 範囲外 ${JSON.stringify(g)} (grid ${tab.rows}x${tab.cols})`);
  return tab;
}
const stats = {};
function applyRequest(req) {
  const [kind, body] = Object.entries(req)[0];
  stats[kind] = (stats[kind] || 0) + 1;
  switch (kind) {
    case 'updateSheetProperties': {
      const tab = byId(body.properties.sheetId);
      sheets.delete(tab.title); tab.title = body.properties.title; sheets.set(tab.title, tab);
      return {};
    }
    case 'addSheet': {
      const p = body.properties;
      if (sheets.has(p.title)) throw new Error(`同名タブがあります: ${p.title}`);
      addTab(p.title, p.gridProperties?.rowCount ?? 1000, p.gridProperties?.columnCount ?? 26, p.index);
      const t = sheets.get(p.title);
      return { addSheet: { properties: { sheetId: t.id, title: t.title } } };
    }
    case 'deleteSheet': {
      const tab = byId(body.sheetId);
      if (sheets.size <= 1) throw new Error('最後のタブは消せません');
      sheets.delete(tab.title); return {};
    }
    case 'mergeCells': {
      const g = body.range; const tab = checkGrid(g, 'mergeCells');
      const m = { r0: g.startRowIndex, r1: g.endRowIndex, c0: g.startColumnIndex, c1: g.endColumnIndex };
      if ((m.r1 - m.r0) * (m.c1 - m.c0) < 2) throw new Error(`1マスの結合 ${JSON.stringify(g)}`);
      for (const x of tab.merges) {
        if (m.r0 < x.r1 && x.r0 < m.r1 && m.c0 < x.c1 && x.c0 < m.c1) throw new Error(`結合が重なっています ${tab.title} ${JSON.stringify(m)} × ${JSON.stringify(x)}`);
      }
      tab.merges.push(m); return {};
    }
    case 'updateDimensionProperties': {
      const g = body.range; const tab = byId(g.sheetId);
      const lim = g.dimension === 'ROWS' ? tab.rows : tab.cols;
      if (g.endIndex > lim || g.startIndex < 0 || g.startIndex >= g.endIndex) throw new Error(`寸法の範囲外 ${JSON.stringify(g)}`);
      return {};
    }
    case 'repeatCell': {
      checkGrid(body.range, 'repeatCell');
      if (!body.fields || !body.fields.split(',').every((f) => f.startsWith('userEnteredFormat.'))) throw new Error(`fields不正 ${body.fields}`);
      return {};
    }
    case 'updateBorders': checkGrid(body.range, 'updateBorders'); return {};
    case 'addConditionalFormatRule': body.rule.ranges.forEach((g) => checkGrid(g, 'condFormat')); return {};
    case 'setDataValidation': checkGrid(body.range, 'dataValidation'); return {};
    default: throw new Error(`未対応のリクエスト: ${kind}`);
  }
}

// ---------- 偽のClaude（台本どおりの意図を返す） ----------
const script = [];
let lastUserContent = '';

globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url);
  const json = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  const fail = (e) => json({ error: e.message }, 400);
  try {
    if (u.host === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600 });
    if (u.host === 'api.anthropic.com') {
      lastUserContent = JSON.parse(opt.body).messages[0].content;
      const next = script.shift();
      if (!next) throw new Error('台本切れ');
      return json({ content: [{ type: 'text', text: JSON.stringify(next) }] });
    }
    if (u.host !== 'sheets.googleapis.com') throw new Error(`想定外の通信 ${url}`);
    const path = decodeURIComponent(u.pathname.replace('/v4/spreadsheets/FAKE', ''));
    const body = opt.body ? JSON.parse(opt.body) : null;
    if (path === '' && (opt.method || 'GET') === 'GET') {
      return json({ sheets: [...sheets.values()].map((s) => ({ properties: { sheetId: s.id, title: s.title, index: s.index } })) });
    }
    if (path === ':batchUpdate') return json({ replies: body.requests.map(applyRequest) });
    if (path === '/values:batchUpdate') {
      assert.strictEqual(body.valueInputOption, 'USER_ENTERED');
      body.data.forEach((d) => writeRange(d.range, d.values)); return json({});
    }
    if (path === '/values:batchGet') {
      return json({ valueRanges: u.searchParams.getAll('ranges').map((r) => ({ range: r, values: readRange(r) })) });
    }
    let m;
    if ((m = path.match(/^\/values\/(.+):append$/))) {
      const { tab } = parseA1(m[1]);
      let last = -1; for (const k of tab.cells.keys()) last = Math.max(last, +k.split(',')[0]);
      writeRange(`${tab.title}!A${last + 2}`, body.values); return json({});
    }
    if ((m = path.match(/^\/values\/(.+)$/))) {
      if (opt.method === 'PUT') { writeRange(m[1], body.values); return json({}); }
      return json({ values: readRange(m[1]) });
    }
    throw new Error(`未対応のパス ${path}`);
  } catch (e) { return fail(e); }
};

// ---------- 本番コードを読み込む ----------
const { main: build } = await import('./build-whiteboard.mjs');
const { seedAll, md } = await import('../src/seed.mjs');
const { handleText } = await import('../src/handler.mjs');
const { buildAlerts, formatDigest } = await import('../src/notify.mjs');
const { TABS, FIRST_ROW } = await import('../src/layout.mjs');

let n = 0;
const ok = (label) => { n++; console.log(`  ✓ ${label}`); };
const B = () => sheets.get(TABS.board);
const at = (tabName, a1) => {
  const { tab, r0, c0 } = parseA1(`${tabName}!${a1}`);
  return tab.cells.get(`${r0},${c0}`) ?? '';
};
const rowVals = (r, from = 'A', to = 'T') => readRange(`${TABS.board}!${from}${r}:${to}${r}`)[0] || [];
const show = (title) => {
  if (!SHOW) return;
  console.log(`\n----- ${title} -----`);
  for (let r = 1; r <= 18; r++) {
    const v = readRange(`${TABS.board}!A${r}:AB${r}`)[0] || [];
    console.log(String(r).padStart(2), v.map((x) => x || '・').join(' | '));
  }
};

console.log('オフライン通しテスト（偽のSheets＋偽のClaude）\n① 組み立て');
await build({ empty: false });
assert.ok(sheets.has('ホワイトボード') && sheets.has('予定表') && sheets.has('納車済')); ok('3つのタブができた');
assert.strictEqual(sheets.get('工程ボード').cells.get('0,0'), '既存データ'); ok('既存の「工程ボード」タブは無傷');
assert.strictEqual(at('ホワイトボード', 'J1'), '進　捗　状　況'); ok('見出し「進捗状況」');
assert.deepStrictEqual(rowVals(2, 'J', 'Q'), ['鈑金', '下地', 'マスキング', '裏吹き', '塗装', '磨き', '組付け', '納車準備']); ok('工程8列（実物どおり）');
assert.strictEqual(at('ホワイトボード', 'A3'), '1'); assert.strictEqual(at('ホワイトボード', 'A18'), '16'); ok('1〜16番');
assert.strictEqual(at('ホワイトボード', 'D3'), '青木 様'); assert.strictEqual(at('ホワイトボード', 'J3'), '松本'); ok('1番：青木様のシエンタ、鈑金に松本の名札（.envのSTAFFが反映）');
assert.strictEqual(at('ホワイトボード', 'F6'), '070'); ok('色番号の先頭0が消えない');
assert.strictEqual(at('ホワイトボード', 'V1'), '部　品　発　注'); assert.strictEqual(at('ホワイトボード', 'W2'), '入荷日'); assert.strictEqual(at('ホワイトボード', 'V8'), '入庫予定'); ok('右側：部品発注（入荷日）・入庫予定');
assert.strictEqual(at('ホワイトボード', 'V14'), '車検・代車　お客様／車種'); assert.strictEqual(at('ホワイトボード', 'X15'), '6R・N-WGN 9:00'); assert.strictEqual(at('ホワイトボード', 'V18'), '青木様／シエンタ'); ok('右下：車検・代車（6R＝車検ラウンド・5行）');
assert.strictEqual(at('予定表', 'A8'), '社長'); assert.strictEqual(at('予定表', 'I1'), 'FALSE'); ok('予定表：スタッフ名・戸締りチェック');
// 2回目の組み立て（作り直し）も通ること
await build({ empty: false });
assert.ok(![...sheets.keys()].some((t) => t.includes('_old_'))); ok('作り直しで古いタブが残らない');
show('組み立て直後');

console.log('② LINE操作');
const say = async (text, intent) => { script.push({ carId: null, toStage: null, staff: null, newCar: null, fields: null, reserve: null, schedule: null, reply: '', ...intent }); return handleText(text); };
assert.ok(lastUserContent === '' || true);

let rep = await say('青木さんのシエンタ 鈑金終わった', { action: 'move', carId: '1', toStage: '下地' });
assert.strictEqual(at('ホワイトボード', 'J3'), ''); assert.strictEqual(at('ホワイトボード', 'K3'), '松本'); ok(`名札が鈑金→下地へ移動 「${rep.split('\n')[1]}」`);
assert.ok(lastUserContent.includes('"staffNames"') && lastUserContent.includes('井上')); ok('Claudeにボード・予定表・スタッフ名を渡している');

rep = await say('大野さんのハイエース 塗装終わった 磨きは井上', { action: 'move', carId: '4', toStage: '磨き', staff: '井上' });
assert.strictEqual(at('ホワイトボード', 'N6'), ''); assert.strictEqual(at('ホワイトボード', 'O6'), '井上'); ok('担当を替えながら移動（塗装→磨き・井上）');

rep = await say('石川さんのワゴンR 担当はあやか', { action: 'assign', carId: '2', staff: 'あやか' });
assert.strictEqual(at('ホワイトボード', 'K4'), 'あやか'); ok('担当だけ変更');

rep = await say('上田さんのノート 納車10/20に変更 バンパー届いた 調色終わった 色058', { action: 'update', carId: '3', fields: { due: '10/20', parts: 'バンパー入荷済', colorState: '調色済', colorCode: '058', memo: null } });
assert.strictEqual(at('ホワイトボード', 'R5'), '10/20'); assert.strictEqual(at('ホワイトボード', 'S5'), 'バンパー入荷済');
assert.strictEqual(at('ホワイトボード', 'G5'), '調色済'); assert.strictEqual(at('ホワイトボード', 'F5'), '058'); ok('納車日・部品・調色・色番号の更新');

rep = await say('近藤様のハイエース入庫 ナンバー7777 納車10/25 トヨタ系 東京海上', { action: 'add', newCar: { cust: '近藤', car: 'ハイエース', number: '7777', due: '10/25', source: 'トヨタ系', insurance: '東京海上' } });
assert.strictEqual(at('ホワイトボード', 'D11'), '近藤 様'); assert.strictEqual(at('ホワイトボード', 'E11'), 'ハイエース／7777');
assert.ok(rep.includes('9番')); ok('新規入庫は空いている一番上（9番）へ');
assert.ok(rep.includes('入庫予定から外しました') && at('ホワイトボード', 'V9') === ''); ok('入庫予定にいた近藤様は予定から外れた');

rep = await say('石田様 来週アクア入庫予定 リヤバンパー', { action: 'reserve', reserve: { cust: '石田', car: 'アクア', content: 'リヤバンパー 10/30' } });
assert.strictEqual(at('ホワイトボード', 'V9'), '石田様'); assert.strictEqual(at('ホワイトボード', 'X9'), 'アクア'); ok('入庫予定に追加（空いた行へ）');

rep = await say('ゆうこ 今日休み', { action: 'schedule', schedule: { name: 'ゆうこさん', slot: '終日', text: '休み' } });
assert.strictEqual(at('予定表', 'B14'), '休み'); assert.strictEqual(at('予定表', 'D14'), '休み'); ok('予定表：ゆうこ 終日休み');
rep = await say('田中 休み', { action: 'schedule', schedule: { name: '田中', slot: '終日', text: '休み' } });
assert.ok(rep.includes('見つかりませんでした')); ok('予定表にいない人は聞き返す');

rep = await say('栗原さんのアウトランダー 納車した', { action: 'move', carId: '8', toStage: '納車済' });
assert.strictEqual(at('ホワイトボード', 'D10'), ''); assert.strictEqual(at('ホワイトボード', 'A10'), '8');
assert.ok(readRange('納車済!A1:J5').some((r) => r.includes('栗原'))); ok('納車済：8番を空けて「納車済」タブに記録');

rep = await say('今どうなってる？', { action: 'status' });
assert.ok(rep.includes('〈下地〉') && rep.includes('青木様のシエンタ(松本)')); ok('状況確認（担当者つき）');

rep = await say('あれやっといて', { action: 'unknown', reply: 'どの車のことですか？' });
assert.strictEqual(rep, 'どの車のことですか？'); ok('分からない時は聞き返す');
show('LINE操作のあと');

console.log('③ 先回り通知');
await seedAll();
const digest = formatDigest(await buildAlerts(new Date()), new Date());
assert.ok(digest.includes(`は納車予定が2台重なっています（石川様・片山様）`)); ok('📅 納車被り（石川様・片山様）');
assert.ok(digest.includes('上田様のノート') && digest.includes('〈マスキング〉')); ok('⚠️ 遅れ（上田様・マスキング）');
assert.ok(digest.includes('🔔 本日納車：大野様のハイエース')); ok('🔔 本日納車（大野様）');
assert.ok(digest.includes('📦 本日入荷：ワゴンRのネームラベル（スズキ部品）') && digest.includes('📦 本日入荷：N-BOXのグロメット')); ok('📦 本日入荷の部品（2件）');
assert.ok(digest.includes('🚗 本日車検：前田様／ファンクロス　6R')); ok('🚗 本日の車検（6R）');

console.log('④ 部品・車検の質問がAIに届く');
await say('今日の車検は？', { action: 'status', reply: '前田様ファンクロス 6R です' });
assert.ok(lastUserContent.includes('"partsOrders"') && lastUserContent.includes('"inspectionAndLoanCars"') && lastUserContent.includes('6R・N-WGN 9:00')); ok('部品発注・車検代車の表もAIに渡している');
if (SHOW) console.log('\n' + digest);

assert.deepStrictEqual(warnings, []); ok('結合セルの中への書き込みなし');
console.log(`\nリクエスト内訳: ${JSON.stringify(stats)}`);
console.log(`\n✅ 全 ${n} 件パス（基準日 ${md(0)}）`);
