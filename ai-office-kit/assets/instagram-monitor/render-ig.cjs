const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  // 1080×1350 の要素をレティナ2xで書き出す
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'ig.html');
  await p.waitForTimeout(400);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'ig-' + (i + 1) + '.png' });
    console.log('wrote ig-' + (i + 1) + '.png');
  }
  await b.close();
})();
