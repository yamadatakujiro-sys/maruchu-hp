// =============================================================
//  ホワイトボードのモデル（実物と同じ並びのシートを読み書きする）
//  ・車：1〜16番の行。今いる工程のマスに担当者名（名札）が入る。
//  ・入庫予定：右側ブロック。・予定表：別タブ（スタッフ×午前午後）。
// =============================================================
import { BOARD } from './config.mjs';
import {
  readValues, batchGetValues, batchUpdateValues, appendValues,
} from './sheets.mjs';
import {
  TABS, BOARD_STAGES, I, L, R, SCHED, FIRST_ROW, LAST_ROW, SLOTS,
  STAGE_FIRST, STAGE_LAST, rowToCar, stageCells, joinCarNum,
} from './layout.mjs';

export const STAGES = BOARD.stages;
export const DONE = BOARD.doneStage;
export const INTAKE = BOARD.intakeStage;

export function stageIndex(name) {
  return STAGES.indexOf(name);
}
export function isValidStage(name) {
  return STAGES.includes(name);
}
export function nextStage(name) {
  const i = stageIndex(name);
  if (i < 0 || i >= STAGES.length - 1) return name;
  return STAGES[i + 1];
}

const B = () => TABS.board;
const BOARD_RANGE = () => `${B()}!A${FIRST_ROW}:${L.updated}${LAST_ROW}`;
const RESERVE_RANGE = () => `${B()}!${R.c0}${R.reserveFirst}:${R.c3}${R.reserveLast}`;
const SCHED_RANGE = () => `${TABS.schedule}!A1:F${SCHED.notesLast}`;

function nowStamp() {
  const d = new Date();
  const p = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 数字だけの値（色番号 070 など）は先頭0が消えないよう文字列として書く
const asText = (v) => (/^\d+$/.test(v || '') ? `'${v}` : (v || ''));

function todayMD() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- 読み ----------
export function parseCars(rows) {
  const cars = [];
  rows.forEach((r, i) => {
    const c = rowToCar(r, FIRST_ROW + i);
    if (c) cars.push(c);
  });
  return cars;
}

export function parseReservations(rows) {
  const list = [];
  rows.forEach((r, i) => {
    const cust = (r[0] || '').toString().trim();
    const car = (r[2] || '').toString().trim();
    const content = (r[3] || '').toString().trim();
    if (!cust && !car && !content) return;
    list.push({ row: R.reserveFirst + i, cust, car, content });
  });
  return list;
}

export function parseSchedule(rows) {
  const g = (r, c) => ((rows[r] || [])[c] ?? '').toString().trim();
  const date = g(0, 0);
  const staff = [];
  for (let k = 0; k < SCHED.staffRows; k++) {
    const r = SCHED.staffFirst - 1 + k;
    const name = g(r, 0);
    if (!name) continue;
    staff.push({
      row: SCHED.staffFirst + k,
      name,
      am: [g(r, 1), g(r, 2)].filter(Boolean).join(' '),
      pm: [g(r, 3), g(r, 4), g(r, 5)].filter(Boolean).join(' '),
    });
  }
  const notes = [];
  for (let k = 0; k < SCHED.notesRows; k++) {
    const v = g(SCHED.notesFirst - 1 + k, 1);
    if (v) notes.push(v);
  }
  return { date, staff, notes };
}

// LINE処理用：ボード・入庫予定・予定表を1回で読む
export async function loadAll() {
  const [boardRows, resRows, schedRows] = await batchGetValues([
    BOARD_RANGE(), RESERVE_RANGE(), SCHED_RANGE(),
  ]);
  return {
    cars: parseCars(boardRows),
    reservations: parseReservations(resRows),
    schedule: parseSchedule(schedRows),
  };
}

// 先回り通知用：車だけ読む
export async function listCars() {
  return parseCars(await readValues(BOARD_RANGE()));
}

export function activeCars(cars) {
  return cars.filter((c) => c.stage !== DONE);
}

export function findById(cars, id) {
  return cars.find((c) => c.id && id != null && c.id.toString() === id.toString());
}

// ---------- 書き ----------
const stageRange = (row) => `${B()}!${STAGE_FIRST}${row}:${STAGE_LAST}${row}`;
const cell = (col, row) => `${B()}!${col}${row}`;

// 指定工程へ動かす（名札を移す）。納車済ならボードから外して「納車済」タブへ記録。
export async function moveCar(car, toStage, staff) {
  if (toStage === DONE) {
    await appendValues(`${TABS.history}!A1`, [[
      todayMD(), car.id, car.inDate, car.source, car.cust, car.carNum,
      car.insurance, car.memo, car.parts, car.due,
    ]]);
    // No（A列）は残して、B〜更新列を空にする
    const width = I.updated - I.inDate + 1;
    await batchUpdateValues([{
      range: `${B()}!${L.inDate}${car.row}:${L.updated}${car.row}`,
      values: [Array(width).fill('')],
    }]);
    return { ...car, stage: DONE };
  }
  const who = staff ?? car.staff;
  const cells = toStage === INTAKE ? BOARD_STAGES.map(() => '') : stageCells(toStage, who);
  await batchUpdateValues([
    { range: stageRange(car.row), values: [cells] },
    { range: cell(L.updated, car.row), values: [[nowStamp()]] },
  ]);
  return { ...car, stage: toStage, staff: toStage === INTAKE ? '' : (who || '') };
}

// 空いている一番上の番号に新しい車を載せる（入庫）
export async function addCar(cars, nc, { stage = INTAKE, staff = '' } = {}) {
  const used = new Set(cars.map((c) => c.row));
  let row = null;
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    if (!used.has(r)) { row = r; break; }
  }
  if (!row) throw new Error(`ボードが満杯です（${SLOTS}台）。納車済の車を外してください。`);

  const cells = BOARD_STAGES.includes(stage) ? stageCells(stage, staff) : BOARD_STAGES.map(() => '');
  const carNum = joinCarNum(nc.car || '', nc.number || '');
  const values = [
    todayMD(),                       // 入庫日
    nc.source || '',                 // 入庫先
    nc.cust ? `${nc.cust} 様` : '',  // お客様
    carNum,                          // 車種／登録番号
    asText(nc.colorCode),            // 色番号
    nc.colorState || '',             // 調色状態
    nc.insurance || '',              // 保険
    nc.memo || '',                   // 備考
    ...cells,                        // 工程8マス
    nc.due || '',                    // 納車予定日
    nc.parts || '',                  // 部品
    nowStamp(),                      // 更新
  ];
  await batchUpdateValues([{ range: `${B()}!${L.inDate}${row}:${L.updated}${row}`, values: [values] }]);
  return {
    row, id: String(row - FIRST_ROW + 1), cust: nc.cust || '', car: nc.car || '',
    number: nc.number || '', stage: BOARD_STAGES.includes(stage) ? stage : INTAKE, staff,
  };
}

// 変更できる項目 → 列
const FIELD_COL = {
  due: 'due', parts: 'parts', memo: 'memo', colorCode: 'colorCode',
  colorState: 'colorState', insurance: 'insurance', source: 'source',
};
export const FIELD_LABEL = {
  due: '納車予定', parts: '部品', memo: '備考', colorCode: '色番号',
  colorState: '調色', insurance: '保険', source: '入庫先',
};

// 納車予定・部品・備考・調色などを書き換える。変えた項目の配列を返す。
export async function updateFields(car, fields) {
  const data = [];
  const changed = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (!(k in FIELD_COL) || v == null) continue;
    const val = v.toString().trim();
    if (!val) continue;
    data.push({ range: cell(L[FIELD_COL[k]], car.row), values: [[k === 'colorCode' ? asText(val) : val]] });
    changed.push([k, val]);
  }
  if (!data.length) return [];
  data.push({ range: cell(L.updated, car.row), values: [[nowStamp()]] });
  await batchUpdateValues(data);
  return changed;
}

// 入庫予定に1件追加（右側ブロックの空き行へ）
export async function addReservation(reservations, { cust = '', car = '', content = '' }) {
  const used = new Set(reservations.map((x) => x.row));
  let row = null;
  for (let r = R.reserveFirst; r <= R.reserveLast; r++) {
    if (!used.has(r)) { row = r; break; }
  }
  if (!row) throw new Error('入庫予定の欄がいっぱいです。入庫した予定を消してください。');
  await batchUpdateValues([
    { range: cell(R.c0, row), values: [[cust ? `${cust.replace(/様$/, '')}様` : '']] },
    { range: `${B()}!${R.c2}${row}:${R.c3}${row}`, values: [[car, content]] },
  ]);
  return { row, cust, car, content };
}

export async function removeReservation(res) {
  await batchUpdateValues([
    { range: cell(R.c0, res.row), values: [['']] },
    { range: `${B()}!${R.c2}${res.row}:${R.c3}${res.row}`, values: [['', '']] },
  ]);
}

// 予定表に書く（午前＝B列、午後＝D列、終日＝両方）
export async function setSchedule(person, slot, text) {
  const data = [];
  if (slot === '午前' || slot === '終日') data.push({ range: `${TABS.schedule}!B${person.row}`, values: [[text]] });
  if (slot === '午後' || slot === '終日') data.push({ range: `${TABS.schedule}!D${person.row}`, values: [[text]] });
  await batchUpdateValues(data);
}

// スタッフ名の照合（完全一致 → 前方一致 → 部分一致）
export function findStaff(staffList, name) {
  const n = (name || '').trim().replace(/(さん|くん|君|ちゃん)$/, '');
  if (!n) return null;
  return staffList.find((s) => s.name === n)
    || staffList.find((s) => s.name.startsWith(n) || n.startsWith(s.name))
    || staffList.find((s) => s.name.includes(n) || n.includes(s.name))
    || null;
}
