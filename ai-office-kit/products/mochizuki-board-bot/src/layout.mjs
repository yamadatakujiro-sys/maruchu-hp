// =============================================================
//  ホワイトボードのセル配置（実物の写真と同じ並び）を一か所で定義する
//  シートを組み立てる側（scripts/build-whiteboard.mjs）と
//  読み書きする側（src/board.mjs）の両方がここを見る。
//
//  ホワイトボード（タブ）
//    1〜2行目 : 見出し（「進 捗 状 況」の下に工程名）
//    3〜18行目: 1〜16番の車（1行＝1台）
//    左から: No / 入庫日 / 入庫先(札) / お客様 / 車種／登録番号 / 調色(色番号) / 調色(状態)
//           / 備考(保険の札) / 備考(メモ) / 工程8列 / 納車予定日 / 部品 / 更新(隠し列)
//    右側  : 部品発注（1〜7行目）／入庫予定（8〜13行目）／代車（14〜18行目）
//
//  予定表（タブ）… 紙の予定表と同じ：スタッフ × 午前・午後 ＋ 備考 ＋ 戸締りチェック
// =============================================================
import { BOARD } from './config.mjs';

export const TABS = BOARD.tabs;
export const BOARD_STAGES = BOARD.boardStages;
export const SLOTS = BOARD.slots || 16;

// 0始まりの列番号 → 列記号（0→A, 27→AB）
export function colLetter(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// --- メインボードの列（0始まり） ---
const NS = BOARD_STAGES.length;
export const I = {
  no: 0,
  inDate: 1,
  source: 2,       // 入庫先の札（ディーラー・紹介元）
  cust: 3,         // お客様（「◯◯ 様」）
  carNum: 4,       // 車種／登録番号
  colorCode: 5,    // 調色：色番号
  colorState: 6,   // 調色：調色中／調色済
  insurance: 7,    // 備考：保険会社の札（自費も）
  memo: 8,         // 備考：メモ
  stageStart: 9,   // 工程列の先頭（鈑金）
  due: 9 + NS,     // 納車予定日
  parts: 10 + NS,  // 部品
  updated: 11 + NS, // 更新日時（隠し列）
  gap: 12 + NS,    // 右側との間の余白
  right: 13 + NS,  // 右側ブロックの先頭列
};
export const RIGHT_WIDTH = 7; // 右側ブロックの列数（V〜AB）
export const TOTAL_COLS = I.right + RIGHT_WIDTH;

export const HEADER_ROWS = 2;
export const FIRST_ROW = 3;                     // 1番の車の行（1始まり）
export const LAST_ROW = FIRST_ROW + SLOTS - 1;  // 16番の車の行

export const L = Object.fromEntries(Object.entries(I).map(([k, v]) => [k, colLetter(v)]));
export const STAGE_FIRST = colLetter(I.stageStart);
export const STAGE_LAST = colLetter(I.stageStart + NS - 1);

// --- 右側ブロック（行は1始まり） ---
// 列: r0=発注先/お客様, r1=日付, r2=車種, r3..r6=部品・内容（r3〜r6を結合）
export const R = {
  c0: colLetter(I.right),
  c1: colLetter(I.right + 1),
  c2: colLetter(I.right + 2),
  c3: colLetter(I.right + 3),
  cLast: colLetter(I.right + RIGHT_WIDTH - 1),
  partsTitleRow: 1,
  partsHeadRow: 2,
  partsFirst: 3,
  partsLast: 7,
  reserveHeadRow: 8,
  reserveFirst: 9,
  reserveLast: 13,
  carHeadRow: 14,      // 代車：見出し（日付が並ぶ）
  carFirst: 15,
  carLast: 18,
  carDays: 5,          // 代車表に並べる日数（今日から5日）
};
// 代車の日付列（c2〜c6）
export const CAR_DAY_COLS = Array.from({ length: R.carDays }, (_, k) => colLetter(I.right + 2 + k));

// --- 予定表タブ（行は1始まり） ---
export const SCHED = {
  titleCell: 'A1',
  lockFirst: 1,           // 戸締りチェック H1〜I5
  lockLabelCol: 'H',
  lockCheckCol: 'I',
  headRow: 7,             // 「午前／午後」
  staffFirst: 8,
  staffRows: 10,
  amCols: ['B', 'C'],
  pmCols: ['D', 'E', 'F'],
  notesFirst: 19,
  notesRows: 6,
};
SCHED.staffLast = SCHED.staffFirst + SCHED.staffRows - 1;
SCHED.notesLast = SCHED.notesFirst + SCHED.notesRows - 1;

// 「シエンタ／8834」→ ['シエンタ','8834']
export function splitCarNum(s) {
  const t = (s || '').trim();
  const m = t.split(/[／/]/);
  if (m.length >= 2) return [m[0].trim(), m.slice(1).join('/').trim()];
  return [t, ''];
}
export function joinCarNum(car, number) {
  return number ? `${car}／${number}` : car;
}

// 「青木 様」→「青木」
export function stripSama(s) {
  return (s || '').toString().trim().replace(/\s*様$/, '').trim();
}

// シートの1行（A〜更新列の配列）→ 車オブジェクト。空行は null。
// 工程は「工程列のうち一番右の埋まっているマス」。そのマスの文字＝担当者（●は担当未定）。
export function rowToCar(r, sheetRow) {
  const g = (i) => (r[i] ?? '').toString().trim();
  const cust = stripSama(g(I.cust));
  const carNum = g(I.carNum);
  if (!cust && !carNum) return null;
  const [car, number] = splitCarNum(carNum);
  let stage = BOARD.intakeStage;
  let staff = '';
  for (let k = 0; k < NS; k++) {
    const v = g(I.stageStart + k);
    if (v) { stage = BOARD_STAGES[k]; staff = v === '●' ? '' : v; }
  }
  return {
    row: sheetRow,
    id: g(I.no) || String(sheetRow - FIRST_ROW + 1),
    inDate: g(I.inDate),
    source: g(I.source),
    cust,
    car,
    number,
    carNum,
    colorCode: g(I.colorCode),
    colorState: g(I.colorState),
    insurance: g(I.insurance),
    memo: g(I.memo),
    stage,
    staff,
    due: g(I.due),
    parts: g(I.parts),
    updated: g(I.updated),
  };
}

// 工程列8マスの値を作る（指定工程のマスにだけ担当者名。担当未定は●）
export function stageCells(stage, staff) {
  const k = BOARD_STAGES.indexOf(stage);
  return BOARD_STAGES.map((_, i) => (i === k ? (staff || '●') : ''));
}
