// ヤフオク出品画像を書き出す（1200×1200・ヤフオクの上限に合わせて等倍）
// 実行： NODE_PATH="$(npm root -g)" node render.cjs
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  // ⚠️ヤフオクは1200pxを超えると自動縮小されるので deviceScaleFactor は 1
  const p = await b.newPage({ viewport: { width: 1260, height: 1260 }, deviceScaleFactor: 1 });
  await p.goto('file://' + dir + 'y.html');
  await p.waitForTimeout(400);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'y-' + (i + 1) + '.png' });
    console.log('wrote y-' + (i + 1) + '.png');
  }
  await b.close();
})();
