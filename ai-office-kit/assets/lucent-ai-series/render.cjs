// Lucent向けカルーセルを書き出す（1080×1350・Instagram縦長4:5）
// 実行： NODE_PATH="$(npm root -g)" node render.cjs
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'post-01.html');
  await p.waitForTimeout(400);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'p1-' + (i + 1) + '.png' });
    console.log('wrote p1-' + (i + 1) + '.png');
  }
  await b.close();
})();
