#!/usr/bin/env node
// =============================================================
//  シート初期化スクリプト
//  ・ヘッダ行（ID/お客様/車種/…）を書き込む
//  ・--sample を付けるとデモ用のサンプル車も投入する
//
//  前提：スプレッドシートを1つ作り、タブ名を「工程ボード」にして
//        サービスアカウントのメール宛に「編集者」で共有しておく。
//        （手順は SETUP.md 参照）
//
//  使い方:
//    node scripts/init-sheet.mjs            … ヘッダのみ
//    node scripts/init-sheet.mjs --sample   … ヘッダ＋サンプル車
// =============================================================
import { BOARD, CONFIG } from '../src/config.mjs';
import { updateValues } from '../src/sheets.mjs';

const TAB = CONFIG.sheetTab;
const withSample = process.argv.includes('--sample');

function stamp() {
  const d = new Date(); const p = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// サンプル（訪問デモにそのまま使える板金塗装の顔ぶれ）
const SAMPLE = [
  [1, '渡辺', 'プリウス', '静岡301あ12-34', '入庫', '8/16', '', stamp(), ''],
  [2, '鈴木', 'N-BOX', '', '分解', '8/20', '', stamp(), ''],
  [3, '佐藤', 'フィット', '', '板金', '8/14', '', stamp(), '左フロントぶつけ'],
  [4, '田中', 'ハイエース', '', '塗装', '8/16', '', stamp(), ''],
  [5, '山本', 'アルファード', '', '組付け', '8/16', '', stamp(), ''],
  [6, '中村', 'タント', '', '検査', '8/18', '', stamp(), ''],
  [7, '小林', 'ノート', '', '納車待ち', '8/13', '', stamp(), ''],
];

(async () => {
  const header = BOARD.sheet.header;
  await updateValues(`${TAB}!A1`, [header]);
  console.log(`✅ ヘッダを書き込みました: ${header.join(' / ')}`);

  if (withSample) {
    await updateValues(`${TAB}!A2`, SAMPLE);
    console.log(`✅ サンプル ${SAMPLE.length} 台を投入しました。`);
  }
  console.log('完了。スプレッドシートを開いて確認してください。');
})().catch((e) => {
  console.error('❌ 失敗:', e.message);
  console.error('・タブ名が「' + TAB + '」になっているか');
  console.error('・サービスアカウントのメールに「編集者」で共有したか');
  console.error('・GOOGLE_SHEET_ID が正しいか を確認してください。');
  process.exit(1);
});
