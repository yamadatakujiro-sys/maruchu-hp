// Lucent 部品買取サムネを書き出す（1080×1350・Instagram縦長4:5）
// 実行： NODE_PATH="$(npm root -g)" node render-buy.cjs
// 実写に差し替えるとき：buy-photo.jpg を同じフォルダに置けば自動で実写版になる
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const dir = __dirname + '/';
  const hasPhoto = fs.existsSync(dir + 'buy-photo.jpg');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'buy-parts.html');
  if (hasPhoto) await p.$eval('.slide', el => el.classList.add('real'));
  await p.waitForTimeout(500);
  const slide = await p.$('.slide');
  await slide.screenshot({ path: dir + 'buy-parts-1.png' });
  console.log('wrote buy-parts-1.png' + (hasPhoto ? '（実写版）' : '（プレースホルダ版）'));
  await b.close();
})();
