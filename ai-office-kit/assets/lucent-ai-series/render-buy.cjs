// Lucent 部品買取サムネを書き出す（1080×1350・Instagram縦長4:5）
// 実行： NODE_PATH="$(npm root -g)" node render-buy.cjs
// 写真は buy-photo.jpg、フォントは fonts/（fetch-fonts.sh で作成）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'buy-parts.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const names = ['A1-red', 'A1-yellow', 'A1-orange'];
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'buy-parts-' + names[i] + '.png' });
    console.log('wrote buy-parts-' + names[i] + '.png');
  }
  await b.close();
})();
