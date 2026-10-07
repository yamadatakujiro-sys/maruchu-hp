#!/usr/bin/env node
// =============================================================
//  ホワイトボード（実物と同じ見た目）をスプレッドシートに組み立てる
//
//  作るタブ:
//    ・ホワイトボード … 1〜16番の車 × 8工程（名札マス）＋ 部品発注・入庫予定・代車
//    ・予定表         … スタッフ × 午前／午後 ＋ 備考 ＋ 戸締りチェック
//    ・納車済         … 納車した車の記録（無ければ作る。あれば残す）
//
//  ※「ホワイトボード」「予定表」は作り直し（中身は消えて見本データが入る）。
//    既存の「工程ボード」タブなど他のタブには触らない。
//
//  使い方:
//    node scripts/build-whiteboard.mjs          … 作る＋見本データ（デモ用）
//    node scripts/build-whiteboard.mjs --empty  … 作る＋空っぽ（本番用）
// =============================================================
import { pathToFileURL } from 'node:url';
import { BOARD } from '../src/config.mjs';
import { getSpreadsheet, batchUpdate, batchUpdateValues } from '../src/sheets.mjs';
import {
  TABS, BOARD_STAGES, I, R, SCHED, FIRST_ROW, LAST_ROW, BOARD_BOTTOM, SLOTS, TOTAL_COLS, RIGHT_WIDTH,
  CAR_DAY_COLS, colLetter,
} from '../src/layout.mjs';
import { seedAll, staffList, wd } from '../src/seed.mjs';

const EMPTY = process.argv.includes('--empty');

// ---------- 小道具 ----------
const rgb = (h) => ({
  red: parseInt(h.slice(1, 3), 16) / 255,
  green: parseInt(h.slice(3, 5), 16) / 255,
  blue: parseInt(h.slice(5, 7), 16) / 255,
});
const INK = '#202124';
const GRAY_BG = '#F1F3F4';
const RED = '#D93025';
// 範囲（0始まり・終わりは含まない）
const gr = (sid, r0, r1, c0, c1) => ({
  sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1,
});
const width = (sid, c0, c1, px) => ({
  updateDimensionProperties: {
    range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 },
    properties: { pixelSize: px }, fields: 'pixelSize',
  },
});
const height = (sid, r0, r1, px) => ({
  updateDimensionProperties: {
    range: { sheetId: sid, dimension: 'ROWS', startIndex: r0, endIndex: r1 },
    properties: { pixelSize: px }, fields: 'pixelSize',
  },
});
const merge = (range) => ({ mergeCells: { range, mergeType: 'MERGE_ALL' } });
// 書式（指定した項目だけ上書き）
function fmt(range, f) {
  const mask = Object.keys(f).map((k) => (k === 'textFormat'
    ? Object.keys(f.textFormat).map((t) => `userEnteredFormat.textFormat.${t}`).join(',')
    : `userEnteredFormat.${k}`)).join(',');
  return { repeatCell: { range, cell: { userEnteredFormat: f }, fields: mask } };
}
const text = (o) => {
  const t = {};
  if (o.size) t.fontSize = o.size;
  if (o.bold != null) t.bold = o.bold;
  if (o.color) t.foregroundColor = rgb(o.color);
  return t;
};
// よく使う書式の組み立て
const style = ({ size, bold, color, bg, h, wrap = true } = {}) => {
  const f = { verticalAlignment: 'MIDDLE' };
  const t = text({ size, bold, color });
  if (Object.keys(t).length) f.textFormat = t;
  if (bg) f.backgroundColor = rgb(bg);
  if (h) f.horizontalAlignment = h;
  if (wrap) f.wrapStrategy = 'WRAP';
  return f;
};
const line = (s, color = INK) => ({ style: s, color: rgb(color) });
function borders(range, outer = 'SOLID_MEDIUM', inner = 'SOLID_MEDIUM', color = INK, innerColor = INK) {
  const b = { range, top: line(outer, color), bottom: line(outer, color), left: line(outer, color), right: line(outer, color) };
  if (inner) { b.innerHorizontal = line(inner, innerColor); b.innerVertical = line(inner, innerColor); }
  return { updateBorders: b };
}
// 条件付き書式（後から追加したものほど優先）
const cond = (ranges, condition, f) => ({
  addConditionalFormatRule: { rule: { ranges, booleanRule: { condition, format: f } }, index: 0 },
});
const notBlank = { type: 'NOT_BLANK' };
const textEq = (v) => ({ type: 'TEXT_EQ', values: [{ userEnteredValue: v }] });
const textHas = (v) => ({ type: 'TEXT_CONTAINS', values: [{ userEnteredValue: v }] });

// ---------- 1) タブを用意（作り直し） ----------
async function prepareTabs() {
  const meta = await getSpreadsheet('sheets.properties(sheetId,title,index)');
  const props = (meta.sheets || []).map((s) => s.properties);
  const byTitle = Object.fromEntries(props.map((p) => [p.title, p]));
  const ts = Date.now();
  const reqs = [];
  const toDelete = [];

  // 同名タブがあれば一旦改名 → 新規作成 → 古い方を削除（タブが0枚になる瞬間を作らない）
  for (const name of [TABS.board, TABS.schedule]) {
    if (byTitle[name]) {
      reqs.push({ updateSheetProperties: { properties: { sheetId: byTitle[name].sheetId, title: `${name}_old_${ts}` }, fields: 'title' } });
      toDelete.push(byTitle[name].sheetId);
    }
  }
  reqs.push({ addSheet: { properties: {
    title: TABS.board, index: 0,
    gridProperties: { rowCount: BOARD_BOTTOM + 5, columnCount: TOTAL_COLS, frozenRowCount: 2, hideGridlines: true },
    tabColorStyle: { rgbColor: rgb('#1A73E8') },
  } } });
  reqs.push({ addSheet: { properties: {
    title: TABS.schedule, index: 1,
    gridProperties: { rowCount: SCHED.notesLast + 4, columnCount: 10, hideGridlines: true },
    tabColorStyle: { rgbColor: rgb('#188038') },
  } } });
  const needHistory = !byTitle[TABS.history];
  if (needHistory) {
    reqs.push({ addSheet: { properties: {
      title: TABS.history, index: 2,
      gridProperties: { rowCount: 500, columnCount: 10, frozenRowCount: 1 },
      tabColorStyle: { rgbColor: rgb('#9AA0A6') },
    } } });
  }
  for (const id of toDelete) reqs.push({ deleteSheet: { sheetId: id } });

  const res = await batchUpdate(reqs);
  const added = {};
  for (const r of res.replies || []) {
    if (r.addSheet) added[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
  }
  return { boardId: added[TABS.board], schedId: added[TABS.schedule], historyId: added[TABS.history] ?? null };
}

// ---------- 2) ホワイトボードの見た目 ----------
function boardFormat(sid) {
  const q = [];
  const NS = BOARD_STAGES.length;
  const d0 = FIRST_ROW - 1;     // データ先頭行（0始まり）
  const d1 = LAST_ROW;          // データ最終行の次
  const mainEnd = I.updated + 1;

  // 列幅
  const W = { no: 36, inDate: 50, source: 74, cust: 82, carNum: 132, colorCode: 56, colorState: 54, insurance: 78, memo: 112, due: 58, parts: 132, updated: 120 };
  for (const [k, px] of Object.entries(W)) q.push(width(sid, I[k], I[k] + 1, px));
  q.push(width(sid, I.stageStart, I.stageStart + NS, 64));
  q.push(width(sid, I.gap, I.gap + 1, 14));
  q.push(width(sid, I.right, I.right + 1, 86));
  q.push(width(sid, I.right + 1, I.right + 2, 64));
  q.push(width(sid, I.right + 2, I.right + 3, 92));
  q.push(width(sid, I.right + 3, I.right + RIGHT_WIDTH, 64));
  q.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: I.updated, endIndex: I.updated + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });

  // 行の高さ
  q.push(height(sid, 0, 1, 28));
  q.push(height(sid, 1, 2, 32));
  q.push(height(sid, d0, BOARD_BOTTOM, 44));

  // 全体の基本（白地・中央・折り返し）
  q.push(fmt(gr(sid, 0, BOARD_BOTTOM, 0, TOTAL_COLS), style({ size: 10, color: INK, bg: '#FFFFFF', h: 'CENTER' })));

  // --- 左：見出し（2段） ---
  q.push(fmt(gr(sid, 0, 2, 0, mainEnd), style({ size: 11, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  for (const [c0, c1] of [[I.no, I.no + 1], [I.inDate, I.inDate + 1], [I.source, I.cust + 1], [I.carNum, I.carNum + 1],
    [I.colorCode, I.colorState + 1], [I.insurance, I.memo + 1], [I.due, I.due + 1], [I.parts, I.parts + 1], [I.updated, I.updated + 1]]) {
    q.push(merge(gr(sid, 0, 2, c0, c1)));
  }
  q.push(merge(gr(sid, 0, 1, I.stageStart, I.stageStart + NS)));
  q.push(fmt(gr(sid, 0, 1, I.stageStart, I.stageStart + NS), style({ size: 14, bold: true, bg: GRAY_BG, h: 'CENTER' })));

  // --- 左：1〜16番の中身 ---
  const col = (c, f) => q.push(fmt(gr(sid, d0, d1, c, c + 1), style(f)));
  col(I.no, { size: 18, bold: true, color: '#3C4043', h: 'CENTER' });
  col(I.inDate, { size: 12, h: 'CENTER' });
  col(I.source, { size: 9, h: 'CENTER' });
  col(I.cust, { size: 12, h: 'CENTER' });
  col(I.carNum, { size: 12, h: 'LEFT' });
  col(I.colorCode, { size: 11, bold: true, h: 'CENTER' });
  col(I.colorState, { size: 9, h: 'CENTER' });
  col(I.insurance, { size: 9, h: 'CENTER' });
  col(I.memo, { size: 10, h: 'LEFT' });
  q.push(fmt(gr(sid, d0, d1, I.stageStart, I.stageStart + NS), style({ size: 11, bold: true, h: 'CENTER' })));
  col(I.due, { size: 12, bold: true, color: RED, h: 'CENTER' });
  col(I.parts, { size: 10, color: RED, h: 'LEFT' });
  col(I.updated, { size: 8, color: '#80868B', h: 'CENTER' });

  // 線：ボード全体は太枠、マス目は中太、工程ブロックの左右は太線
  q.push(borders(gr(sid, 0, d1, 0, mainEnd), 'SOLID_THICK', 'SOLID_MEDIUM'));
  q.push(borders(gr(sid, 0, d1, I.stageStart, I.stageStart + NS), 'SOLID_THICK', null));

  // 名札（工程マスに名前が入ったら黄色）
  q.push(cond([gr(sid, d0, d1, I.stageStart, I.stageStart + NS)], notBlank, { backgroundColor: rgb('#FFE15A'), textFormat: { bold: true, foregroundColor: rgb(INK) } }));
  // 入庫先の札（緑）
  q.push(cond([gr(sid, d0, d1, I.source, I.source + 1)], notBlank, { backgroundColor: rgb('#E6F4EA'), textFormat: { foregroundColor: rgb('#137333') } }));
  // 保険の札（青）、自費は赤
  q.push(cond([gr(sid, d0, d1, I.insurance, I.insurance + 1)], notBlank, { backgroundColor: rgb('#E8F0FE'), textFormat: { foregroundColor: rgb('#1967D2') } }));
  q.push(cond([gr(sid, d0, d1, I.insurance, I.insurance + 1)], textEq('自費'), { backgroundColor: rgb('#FCE8E6'), textFormat: { bold: true, foregroundColor: rgb('#C5221F') } }));
  // 調色の札
  q.push(cond([gr(sid, d0, d1, I.colorState, I.colorState + 1)], textEq('調色中'), { backgroundColor: rgb('#ECEFF1'), textFormat: { foregroundColor: rgb('#5F6368') } }));
  q.push(cond([gr(sid, d0, d1, I.colorState, I.colorState + 1)], textEq('調色済'), { backgroundColor: rgb('#FFF3B0'), textFormat: { bold: true } }));
  // 調色は選択式
  q.push({ setDataValidation: { range: gr(sid, d0, d1, I.colorState, I.colorState + 1), rule: {
    condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: '調色中' }, { userEnteredValue: '調色済' }] },
    showCustomUi: true, strict: false,
  } } });

  // --- 右：部品発注 ---
  const c0 = I.right;
  const cE = I.right + RIGHT_WIDTH;
  const c3 = I.right + 3;
  q.push(merge(gr(sid, R.partsTitleRow - 1, R.partsTitleRow, c0, cE)));
  q.push(merge(gr(sid, R.partsHeadRow - 1, R.partsHeadRow, c3, cE)));
  q.push(fmt(gr(sid, R.partsTitleRow - 1, R.partsHeadRow, c0, cE), style({ size: 11, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  q.push(fmt(gr(sid, R.partsTitleRow - 1, R.partsTitleRow, c0, cE), style({ size: 13, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  for (let r = R.partsFirst; r <= R.partsLast; r++) q.push(merge(gr(sid, r - 1, r, c3, cE)));
  q.push(fmt(gr(sid, R.partsFirst - 1, R.partsLast, c0, c0 + 1), style({ size: 10, h: 'CENTER' })));
  q.push(fmt(gr(sid, R.partsFirst - 1, R.partsLast, c0 + 1, c0 + 2), style({ size: 11, bold: true, color: RED, h: 'CENTER' })));
  q.push(fmt(gr(sid, R.partsFirst - 1, R.partsLast, c3, cE), style({ size: 10, h: 'LEFT' })));
  q.push(borders(gr(sid, 0, R.partsLast, c0, cE), 'SOLID_THICK', 'SOLID_MEDIUM'));

  // --- 右：入庫予定（赤枠の札） ---
  const rh = R.reserveHeadRow - 1;
  q.push(merge(gr(sid, rh, rh + 1, c0, c0 + 2)));
  q.push(merge(gr(sid, rh, rh + 1, c3, cE)));
  q.push(fmt(gr(sid, rh, rh + 1, c0, cE), style({ size: 10, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  q.push(fmt(gr(sid, rh, rh + 1, c0, c0 + 2), style({ size: 13, bold: true, color: RED, bg: '#FFFFFF', h: 'CENTER' })));
  for (let r = R.reserveFirst; r <= R.reserveLast; r++) {
    q.push(merge(gr(sid, r - 1, r, c0, c0 + 2)));
    q.push(merge(gr(sid, r - 1, r, c3, cE)));
  }
  q.push(fmt(gr(sid, R.reserveFirst - 1, R.reserveLast, c0, c0 + 2), style({ size: 11, h: 'LEFT' })));
  q.push(fmt(gr(sid, R.reserveFirst - 1, R.reserveLast, c3, cE), style({ size: 10, h: 'LEFT' })));
  q.push(borders(gr(sid, rh, R.reserveLast, c0, cE), 'SOLID_THICK', 'DOTTED', INK, '#9AA0A6'));
  q.push(borders(gr(sid, rh, rh + 1, c0, c0 + 2), 'SOLID_MEDIUM', null, RED));

  // --- 右：代車（お客様／車種 × 日付） ---
  const ch = R.carHeadRow - 1;
  q.push(merge(gr(sid, ch, ch + 1, c0, c0 + 2)));
  q.push(fmt(gr(sid, ch, ch + 1, c0, cE), style({ size: 10, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  for (let r = R.carFirst; r <= R.carLast; r++) q.push(merge(gr(sid, r - 1, r, c0, c0 + 2)));
  q.push(fmt(gr(sid, R.carFirst - 1, R.carLast, c0, c0 + 2), style({ size: 11, h: 'LEFT' })));
  q.push(fmt(gr(sid, R.carFirst - 1, R.carLast, c0 + 2, cE), style({ size: 10, bold: true, color: '#1A73E8', h: 'CENTER' })));
  q.push(borders(gr(sid, ch, R.carLast, c0, cE), 'SOLID_THICK', 'SOLID_MEDIUM'));
  // 代車の札（黄色の丸マグネット風）
  q.push(cond([gr(sid, R.carFirst - 1, R.carLast, c0 + 2, cE)], notBlank, { backgroundColor: rgb('#FFE15A'), textFormat: { bold: true, foregroundColor: rgb(INK) } }));
  // 車検のラウンド（6R・2R など）は青い丸札（代車より優先）
  const dayTop = `${colLetter(c0 + 2)}${R.carFirst}`;
  q.push(cond([gr(sid, R.carFirst - 1, R.carLast, c0 + 2, cE)], { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=REGEXMATCH(${dayTop},"[0-9]+ *[Rr]")` }] },
    { backgroundColor: rgb('#E8F0FE'), textFormat: { bold: true, foregroundColor: rgb('#1A73E8') } }));

  return q;
}

// ---------- 3) 予定表の見た目 ----------
function schedFormat(sid) {
  const q = [];
  const s0 = SCHED.staffFirst - 1;
  const s1 = SCHED.staffLast;
  const n0 = SCHED.notesFirst - 1;
  const n1 = SCHED.notesLast;
  const h = SCHED.headRow - 1;

  [[0, 96], [1, 130], [2, 70], [3, 130], [4, 70], [5, 70], [6, 20], [7, 110], [8, 44]].forEach(([c, px]) => q.push(width(sid, c, c + 1, px)));
  q.push(height(sid, 0, 2, 30));
  q.push(height(sid, h, h + 1, 32));
  q.push(height(sid, s0, s1, 42));
  q.push(height(sid, n0, n1, 32));

  q.push(fmt(gr(sid, 0, n1, 0, 9), style({ size: 11, color: INK, bg: '#FFFFFF', h: 'LEFT' })));

  // タイトル（日付）
  q.push(merge(gr(sid, 0, 2, 0, 6)));
  q.push(fmt(gr(sid, 0, 2, 0, 6), style({ size: 18, bold: true, h: 'CENTER' })));

  // 戸締りチェック（右上の小さい表）
  const l0 = SCHED.lockFirst - 1;
  const l1 = l0 + BOARD.lockChecks.length;
  q.push(fmt(gr(sid, l0, l1, 7, 8), style({ size: 10, h: 'LEFT' })));
  q.push(borders(gr(sid, l0, l1, 7, 9), 'SOLID_MEDIUM', 'SOLID'));
  q.push({ setDataValidation: { range: gr(sid, l0, l1, 8, 9), rule: { condition: { type: 'BOOLEAN' } } } });

  // 午前／午後の見出し
  q.push(merge(gr(sid, h, h + 1, 1, 3)));
  q.push(merge(gr(sid, h, h + 1, 3, 6)));
  q.push(fmt(gr(sid, h, h + 1, 0, 6), style({ size: 12, bold: true, bg: GRAY_BG, h: 'CENTER' })));

  // スタッフ行
  q.push(fmt(gr(sid, s0, s1, 0, 1), style({ size: 13, bold: true, h: 'CENTER' })));
  q.push(borders(gr(sid, h, s1, 0, 6), 'SOLID_THICK', 'SOLID_MEDIUM'));
  q.push(borders(gr(sid, s0, s1, 1, 3), 'SOLID_MEDIUM', 'DOTTED', INK, '#5F6368'));
  q.push(borders(gr(sid, s0, s1, 3, 6), 'SOLID_MEDIUM', 'DOTTED', INK, '#5F6368'));
  // 休みは赤
  q.push(cond([gr(sid, s0, s1, 1, 6)], textHas('休'), { backgroundColor: rgb('#FCE8E6'), textFormat: { bold: true, foregroundColor: rgb('#C5221F') } }));

  // 備考欄
  q.push(merge(gr(sid, n0, n1, 0, 1)));
  for (let r = n0; r < n1; r++) q.push(merge(gr(sid, r, r + 1, 1, 6)));
  q.push(fmt(gr(sid, n0, n1, 0, 1), style({ size: 12, bold: true, bg: GRAY_BG, h: 'CENTER' })));
  q.push(borders(gr(sid, n0, n1, 0, 6), 'SOLID_THICK', 'SOLID_MEDIUM'));
  return q;
}

function historyFormat(sid) {
  return [
    fmt(gr(sid, 0, 1, 0, 10), style({ size: 11, bold: true, bg: GRAY_BG, h: 'CENTER' })),
    width(sid, 0, 10, 100),
  ];
}

// ---------- 4) 見出しの文字 ----------
function headerValues() {
  const B = TABS.board;
  const T = TABS.schedule;
  const L = (i) => colLetter(i);
  const d = [
    { range: `${B}!${L(I.no)}1`, values: [['No']] },
    { range: `${B}!${L(I.inDate)}1`, values: [['入庫日']] },
    { range: `${B}!${L(I.source)}1`, values: [['入庫先']] },
    { range: `${B}!${L(I.carNum)}1`, values: [['車種／登録番号']] },
    { range: `${B}!${L(I.colorCode)}1`, values: [['調　色']] },
    { range: `${B}!${L(I.insurance)}1`, values: [['備　考']] },
    { range: `${B}!${L(I.stageStart)}1`, values: [['進　捗　状　況']] },
    { range: `${B}!${L(I.stageStart)}2:${L(I.stageStart + BOARD_STAGES.length - 1)}2`, values: [BOARD_STAGES] },
    { range: `${B}!${L(I.due)}1`, values: [['納車\n予定日']] },
    { range: `${B}!${L(I.parts)}1`, values: [['部　品']] },
    { range: `${B}!${L(I.updated)}1`, values: [['更新']] },
    { range: `${B}!A${FIRST_ROW}:A${LAST_ROW}`, values: Array.from({ length: SLOTS }, (_, i) => [i + 1]) },
    { range: `${B}!${R.c0}${R.partsTitleRow}`, values: [['部　品　発　注']] },
    { range: `${B}!${R.c0}${R.partsHeadRow}:${R.c3}${R.partsHeadRow}`, values: [['発注先', '入荷日', '車種', '部品・納期等（×＝交換）']] },
    { range: `${B}!${R.c0}${R.reserveHeadRow}`, values: [['入庫予定']] },
    { range: `${B}!${R.c2}${R.reserveHeadRow}:${R.c3}${R.reserveHeadRow}`, values: [['車種', '内容・予定']] },
    { range: `${B}!${R.c0}${R.carHeadRow}`, values: [['車検・代車　お客様／車種']] },
    { range: `${B}!${CAR_DAY_COLS[0]}${R.carHeadRow}:${CAR_DAY_COLS[CAR_DAY_COLS.length - 1]}${R.carHeadRow}`, values: [CAR_DAY_COLS.map((_, k) => wd(k))] },
    { range: `${T}!B${SCHED.headRow}`, values: [['午　　前']] },
    { range: `${T}!D${SCHED.headRow}`, values: [['午　　後']] },
    { range: `${T}!A${SCHED.notesFirst}`, values: [['備　考']] },
    { range: `${T}!${SCHED.lockLabelCol}${SCHED.lockFirst}:${SCHED.lockLabelCol}${SCHED.lockFirst + BOARD.lockChecks.length - 1}`, values: BOARD.lockChecks.map((x) => [x]) },
  ];
  return d;
}

// 空っぽで作るとき：予定表の日付とスタッフ名だけ入れる
function frameValues() {
  const T = TABS.schedule;
  const now = new Date();
  const W = ['日', '月', '火', '水', '木', '金', '土'];
  const S = staffList();
  return [
    { range: `${T}!A1`, values: [[`${now.getMonth() + 1}月${now.getDate()}日（${W[now.getDay()]}）　予定表`]] },
    { range: `${T}!A${SCHED.staffFirst}:A${SCHED.staffLast}`, values: Array.from({ length: SCHED.staffRows }, (_, k) => [S[k] || '']) },
  ];
}

export async function main({ empty = EMPTY } = {}) {
  console.log('🛠  ホワイトボードを組み立てます…');
  const { boardId, schedId, historyId } = await prepareTabs();
  const reqs = [...boardFormat(boardId), ...schedFormat(schedId)];
  if (historyId != null) reqs.push(...historyFormat(historyId));
  await batchUpdate(reqs);

  const values = headerValues();
  if (historyId != null) {
    values.push({ range: `${TABS.history}!A1:J1`, values: [['納車日', 'No', '入庫日', '入庫先', 'お客様', '車種／登録番号', '保険', '備考', '部品', '納車予定日']] });
  }
  await batchUpdateValues(values);

  if (empty) {
    await batchUpdateValues(frameValues());
    console.log('✅ 空のホワイトボードと予定表を作りました（本番用）。');
  } else {
    const r = await seedAll();
    console.log(`✅ ホワイトボード・予定表を作り、見本データ（車${r.cars}台・スタッフ${r.staff}名）を入れました。`);
  }
  console.log(`   タブ：「${TABS.board}」「${TABS.schedule}」「${TABS.history}」`);
  console.log('   スプレッドシートを開いて確認してください。');
}

// コマンドとして実行されたときだけ動かす（テストから main() を呼べるように）
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error('❌ 失敗:', e.message);
    console.error('・サービスアカウントに「編集者」で共有しているか／GOOGLE_SHEET_ID が正しいか を確認してください。');
    process.exit(1);
  });
}
