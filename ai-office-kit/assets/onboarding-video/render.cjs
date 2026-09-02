// 使い方動画（字幕版）のスライドをPNGに書き出す
// 実行： NODE_PATH="$(npm root -g)" node render.cjs
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + dir + 'slides.html');
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    await slides[i].screenshot({ path: dir + 'slide-' + n + '.png' });
    console.log('wrote slide-' + n + '.png');
  }
  await b.close();
})();
