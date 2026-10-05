// Lucent 入荷の現場投稿サムネを書き出す（1080×1350・Instagram縦長4:5）
// 実行： NODE_PATH="$(npm root -g)" node render-arrival.cjs
// 写真は arrival-photo.webp、フォントは fonts/（bash fetch-fonts.sh arrival.html で作成）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'arrival.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'arrival-' + (i + 1) + '.png' });
    console.log('wrote arrival-' + (i + 1) + '.png');
  }
  await b.close();
})();
