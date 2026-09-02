// =============================================================
//  工程ボードのモデル（スプレッドシートを「車の一覧」として扱う）
// =============================================================
import { BOARD, CONFIG } from './config.mjs';
import { readValues, updateValues, appendValues } from './sheets.mjs';

const TAB = () => CONFIG.sheetTab;
const COL = BOARD.sheet.columns;
const FIRST = BOARD.sheet.firstDataRow;

export const STAGES = BOARD.stages;
export const DONE = BOARD.doneStage;

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

// 現在の全車を読み込む（行番号つき）
export async function listCars() {
  const range = `${TAB()}!${COL.id}${FIRST}:${BOARD.sheet.lastColumn}`;
  const rows = await readValues(range);
  const cars = [];
  rows.forEach((r, i) => {
    // 空行はスキップ（お客様も車種も空なら無視）
    const cust = (r[1] || '').trim();
    const car = (r[2] || '').trim();
    if (!cust && !car) return;
    cars.push({
      row: FIRST + i,
      id: (r[0] || '').toString().trim(),
      cust,
      car,
      number: (r[3] || '').trim(),
      stage: (r[4] || '').trim(),
      due: (r[5] || '').trim(),
      staff: (r[6] || '').trim(),
      updated: (r[7] || '').trim(),
      memo: (r[8] || '').trim(),
    });
  });
  return cars;
}

export function activeCars(cars) {
  return cars.filter((c) => c.stage !== DONE);
}

export function findById(cars, id) {
  return cars.find((c) => c.id && id && c.id.toString() === id.toString());
}

function nowStamp() {
  const d = new Date();
  const p = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 1台を指定工程へ動かす（E列＝工程、H列＝更新日時）
export async function moveCar(car, toStage) {
  await updateValues(`${TAB()}!${COL.stage}${car.row}`, [[toStage]]);
  await updateValues(`${TAB()}!${COL.updated}${car.row}`, [[nowStamp()]]);
  return { ...car, stage: toStage, updated: nowStamp() };
}

// 新しい車を追加（入庫）。id は既存最大+1。
export async function addCar(cars, { cust, car, number = '', stage, due = '', staff = '', memo = '' }) {
  const maxId = cars.reduce((m, c) => Math.max(m, parseInt(c.id, 10) || 0), 0);
  const id = maxId + 1;
  const st = isValidStage(stage) ? stage : STAGES[0];
  const range = `${TAB()}!${COL.id}${FIRST}`;
  await appendValues(range, [[id, cust, car, number, st, due, staff, nowStamp(), memo]]);
  return { id: id.toString(), cust, car, number, stage: st, due, staff, updated: nowStamp(), memo };
}
