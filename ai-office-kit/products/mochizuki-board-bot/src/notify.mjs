// =============================================================
//  先回り通知のロジック（納期の重なり・遅れ・本日納車）
//  シートを読んでアラート文を組み立てる。送信は bin/notify.mjs が行う。
// =============================================================
import { BOARD } from './config.mjs';
import { listCars, activeCars, stageIndex } from './board.mjs';

// 納車予定の文字列を Date に。対応形式: "2026-08-16" / "8/16" / "8月16日"
export function parseDue(s, today = new Date()) {
  if (!s) return null;
  const t = s.trim();
  let y = today.getFullYear(), m, d;
  let mo;
  if ((mo = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    y = +mo[1]; m = +mo[2]; d = +mo[3];
  } else if ((mo = t.match(/^(\d{1,2})[/](\d{1,2})$/))) {
    m = +mo[1]; d = +mo[2];
  } else if ((mo = t.match(/^(\d{1,2})月(\d{1,2})日?$/))) {
    m = +mo[1]; d = +mo[2];
  } else {
    return null;
  }
  const date = new Date(y, m - 1, d);
  // 「8/16」のように年が無い場合、過去になったら来年扱い（年跨ぎ対策）
  if (!/^\d{4}/.test(t)) {
    const diff = (date - today) / 86400000;
    if (diff < -180) date.setFullYear(y + 1);
  }
  return date;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
function fmt(date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${WD[date.getDay()]})`;
}
function daysBetween(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((A - B) / 86400000);
}

// 現在のボードからアラート配列を作る
export async function buildAlerts(today = new Date()) {
  const cars = activeCars(await listCars());
  const rule = BOARD.notify;
  const alerts = [];

  // 1) 同日納車の重なり
  const byDate = {};
  for (const c of cars) {
    const due = parseDue(c.due, today);
    if (!due) continue;
    const key = `${due.getFullYear()}-${due.getMonth() + 1}-${due.getDate()}`;
    (byDate[key] ||= []).push({ c, due });
  }
  for (const arr of Object.values(byDate)) {
    if (arr.length >= (rule.sameDayCollisionMin || 2)) {
      const names = arr.map((x) => `${x.c.cust}様`).join('・');
      alerts.push({ level: 'crit', text: `📅 ${fmt(arr[0].due)} は納車予定が${arr.length}台重なっています（${names}）` });
    }
  }

  // 2) 納期が迫っているのに工程が遅れている
  for (const c of cars) {
    const due = parseDue(c.due, today);
    if (!due) continue;
    const dt = daysBetween(due, today);
    const si = stageIndex(c.stage);
    if (dt >= 0 && dt <= (rule.delayWithinDays ?? 1) && si >= 0 && si < (rule.warnBeforeStageIndex ?? 6)) {
      alerts.push({ level: 'warn', text: `⚠️ ${c.cust}様の${c.car}：納車まであと${dt}日（${fmt(due)}）、まだ〈${c.stage}〉です` });
    }
  }

  // 3) 本日納車の案内
  for (const c of cars) {
    const due = parseDue(c.due, today);
    if (!due) continue;
    if (daysBetween(due, today) === 0) {
      alerts.push({ level: 'info', text: `🔔 本日納車：${c.cust}様の${c.car}（いまの工程は〈${c.stage}〉）` });
    }
  }

  return alerts;
}

// アラート配列を1通のダイジェスト文へ
export function formatDigest(alerts, today = new Date()) {
  if (alerts.length === 0) return null;
  const order = { crit: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => (order[a.level] - order[b.level]));
  const head = `【工程ボード｜先回り通知 ${today.getMonth() + 1}/${today.getDate()}(${WD[today.getDay()]})】`;
  return [head, ...alerts.map((a) => a.text)].join('\n');
}
