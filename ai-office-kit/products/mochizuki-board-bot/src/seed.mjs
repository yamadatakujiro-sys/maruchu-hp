// =============================================================
//  見本データ（デモ用）をホワイトボード・予定表に書き込む
//  ・お客様名はすべて架空（公開リポジトリのため）。スタッフ名は .env の STAFF を使う
//    （未設定なら board.config.json の defaultStaff）。
//  ・日付は実行した日を基準に自動計算（いつ叩いても「今日以降」に並ぶ）。
//  ・先回り通知が3種類とも出る配置：
//      📅 納車被り … 2番・6番（3日後）
//      ⚠️ 遅れ    … 3番（明日なのにマスキング）・4番（今日なのに塗装）
//      🔔 本日納車 … 4番
// =============================================================
import { BOARD, CONFIG } from './config.mjs';
import { batchUpdateValues } from './sheets.mjs';
import {
  TABS, L, R, SCHED, FIRST_ROW, LAST_ROW, SLOTS, CAR_DAY_COLS, BOARD_STAGES, stageCells,
} from './layout.mjs';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
function day(off) { const d = new Date(); d.setDate(d.getDate() + off); return d; }
export const md = (off) => { const d = day(off); return `${d.getMonth() + 1}/${d.getDate()}`; };
export const wd = (off) => { const d = day(off); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
function stamp() {
  const d = new Date(); const p = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 数字だけの文字列（色番号 070 など）は先頭0が消えないよう文字列として書く
export const asText = (v) => (/^\d+$/.test(v || '') ? `'${v}` : (v || ''));

export function staffList() {
  return CONFIG.staff.length ? CONFIG.staff : BOARD.defaultStaff;
}

// 見本の車（工程は名前で指定。担当は staff の何番目か＝社長(0)以外を順に）
export function demoCars(S) {
  const st = (i) => (S.length > 1 ? S[1 + ((i - 1) % (S.length - 1))] : (S[0] || ''));
  return [
    { inDate: md(-8),  source: 'トヨタ系',   cust: '青木', carNum: 'シエンタ／1234',     colorCode: '4X4',    colorState: '調色済', insurance: '東京海上',   memo: '代車あり',           stage: '鈑金',       staff: st(1), due: md(5), parts: 'パワスラセンサ 入荷待ち' },
    { inDate: md(-12), source: 'スズキ系',   cust: '石川', carNum: 'ワゴンR／5678',      colorCode: 'ZJ3',    colorState: '調色中', insurance: '自費',       memo: '',                   stage: '下地',       staff: st(6), due: md(3), parts: 'ネームラベル' },
    { inDate: md(-10), source: '日産系',     cust: '上田', carNum: 'ノート／2468',       colorCode: 'KAD',    colorState: '調色済', insurance: '三井住友',   memo: 'アジャスター立会済', stage: 'マスキング', staff: st(3), due: md(1), parts: 'OK' },
    { inDate: md(-25), source: '直接',       cust: '大野', carNum: 'ハイエース／1357',   colorCode: '070',    colorState: '調色済', insurance: '損保ジャパン', memo: '',                 stage: '塗装',       staff: st(4), due: md(0), parts: '' },
    { inDate: md(-6),  source: 'ダイハツ系', cust: '小川', carNum: 'タント／9753',       colorCode: 'W24',    colorState: '調色中', insurance: '自費',       memo: '連絡まち',           stage: '入庫',       staff: '',    due: md(7), parts: `バンパー ${md(4)}仮` },
    { inDate: md(-15), source: 'トヨタ系',   cust: '片山', carNum: 'プリウス／8642',     colorCode: '1F7',    colorState: '調色済', insurance: 'JA共済',     memo: '',                   stage: '磨き',       staff: st(5), due: md(3), parts: '' },
    { inDate: md(-20), source: 'ホンダ系',   cust: '木村', carNum: 'N-BOX／3141',        colorCode: 'NH883P', colorState: '調色済', insurance: '東京海上',   memo: 'エーミング 16:00〜', stage: '組付け',     staff: st(2), due: md(2), parts: 'OK' },
    { inDate: md(-30), source: '保険紹介',   cust: '栗原', carNum: 'アウトランダー／2718', colorCode: 'X42',  colorState: '調色済', insurance: '損保ジャパン', memo: 'タイヤ4本交換',    stage: '納車準備',   staff: st(7), due: md(4), parts: 'OK' },
  ];
}

const B = TABS.board;

// ホワイトボード・予定表に見本データを書く（見出しや書式はそのまま）
export async function seedAll() {
  const S = staffList();
  const data = [];

  // --- 1〜16番：No と車 ---
  data.push({ range: `${B}!A${FIRST_ROW}:A${LAST_ROW}`, values: Array.from({ length: SLOTS }, (_, i) => [i + 1]) });
  const cars = demoCars(S);
  const rows = [];
  for (let i = 0; i < SLOTS; i++) {
    const c = cars[i];
    if (!c) { rows.push(Array(8 + BOARD_STAGES.length + 3).fill('')); continue; }
    rows.push([
      c.inDate, c.source, `${c.cust} 様`, c.carNum, asText(c.colorCode), c.colorState, c.insurance, c.memo,
      ...(BOARD_STAGES.includes(c.stage) ? stageCells(c.stage, c.staff) : BOARD_STAGES.map(() => '')),
      c.due, c.parts, stamp(),
    ]);
  }
  data.push({ range: `${B}!${L.inDate}${FIRST_ROW}:${L.updated}${LAST_ROW}`, values: rows });

  // --- 部品発注（右上） ---
  const parts = [
    ['トヨタ部品',   md(1), 'シエンタ',   'パワースライドドアセンサ'],
    ['日産部品',     md(2), 'ノート',     `フロントバンパー（${md(4)}仮）`],
    ['スズキ部品',   md(0), 'ワゴンR',    'ネームラベル'],
    ['ダイハツ部品', md(1), 'タント',     `バンパー　全部そろうのは${md(4)}`],
    ['ホンダ部品',   md(0), 'N-BOX',      'グロメット'],
  ];
  parts.forEach((p, k) => {
    const r = R.partsFirst + k;
    data.push({ range: `${B}!${R.c0}${r}:${R.c3}${r}`, values: [p] });
  });

  // --- 入庫予定（右中） ---
  const reserves = [
    ['近藤様', 'ハイエース',     `リヤバンパー　${wd(2)} 9:00`],
    ['坂本様', 'アルファード',   'フェンダー　仮予約'],
    ['中川様', 'XV',             `バックカメラ　${wd(1)}`],
    ['西村様', 'エクストレイル', '右フロントドア〜リヤドア　TELくれる'],
    ['原田様', 'ヴェゼル',       `左フェンダー・ドア・ミラー　${wd(7)}夕方`],
  ];
  reserves.forEach((x, k) => {
    const r = R.reserveFirst + k;
    data.push({ range: `${B}!${R.c0}${r}`, values: [[x[0]]] });
    data.push({ range: `${B}!${R.c2}${r}:${R.c3}${r}`, values: [[x[1], x[2]]] });
  });

  // --- 代車（右下）：見出しの日付＋貸出 ---
  const dayCols = `${CAR_DAY_COLS[0]}`;
  const lastDay = CAR_DAY_COLS[CAR_DAY_COLS.length - 1];
  data.push({ range: `${B}!${dayCols}${R.carHeadRow}:${lastDay}${R.carHeadRow}`, values: [CAR_DAY_COLS.map((_, k) => wd(k))] });
  const loans = [
    ['青木様／シエンタ', ['N-WGN 9:00〜', 'N-WGN', 'N-WGN', 'N-WGN', 'N-WGN']],
    ['上田様／ノート',   ['クリッパー 17:00〜', 'クリッパー', '夜 返却', '', '']],
    ['片山様／プリウス', ['', '', 'エブリィ', 'エブリィ', 'エブリィ']],
    ['', ['', '', '', '', '']],
  ];
  loans.forEach(([who, days], k) => {
    const r = R.carFirst + k;
    data.push({ range: `${B}!${R.c0}${r}`, values: [[who]] });
    data.push({ range: `${B}!${dayCols}${r}:${lastDay}${r}`, values: [days.slice(0, CAR_DAY_COLS.length)] });
  });

  // --- 予定表タブ ---
  const today = day(0);
  const T = TABS.schedule;
  data.push({ range: `${T}!A1`, values: [[`${today.getMonth() + 1}月${today.getDate()}日（${WD[today.getDay()]}）　予定表`]] });
  const plan = [
    ['見積り（来客 10:00）', '保険会社 打合せ'],
    ['シエンタ 鈑金', 'シエンタ 鈑金'],
    ['N-BOX 組付け', 'エーミング 16:00'],
    ['ノート マスキング', 'ノート マスキング'],
    ['ハイエース 塗装', 'ハイエース 塗装'],
    ['プリウス 磨き', '代車 引取り'],
    ['休み', '休み'],
    ['アウトランダー 納車準備', 'アウトランダー 納車 2R'],
  ];
  const schedRows = [];
  for (let k = 0; k < SCHED.staffRows; k++) {
    const name = S[k] || '';
    const p = name ? (plan[k] || ['', '']) : ['', ''];
    schedRows.push([name, p[0], '', p[1], '', '']);
  }
  data.push({ range: `${T}!A${SCHED.staffFirst}:F${SCHED.staffLast}`, values: schedRows });
  const notes = ['青木様 代車（N-WGN）は納車時に返却', '部品 15時着予定（トヨタ部品）', '', '', '', ''];
  data.push({ range: `${T}!B${SCHED.notesFirst}:B${SCHED.notesLast}`, values: notes.slice(0, SCHED.notesRows).map((n) => [n]) });
  data.push({ range: `${T}!${SCHED.lockCheckCol}${SCHED.lockFirst}:${SCHED.lockCheckCol}${SCHED.lockFirst + BOARD.lockChecks.length - 1}`, values: BOARD.lockChecks.map(() => [false]) });

  await batchUpdateValues(data);
  return { cars: cars.length, staff: S.length };
}
