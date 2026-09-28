// @line_ai_office「買取告知の裏側」カルーセルを書き出す（1080×1350・Instagram縦長4:5）
// 実行： NODE_PATH="$(npm root -g)" node render-behind.cjs
// 4枚目の画像は ../lucent-ai-series/buy-parts-A1-orange.png、フォントは fonts/（fetch-fonts.sh で作成）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'behind-buy.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'behind-' + (i + 1) + '.png' });
    console.log('wrote behind-' + (i + 1) + '.png');
  }
  await b.close();
})();
