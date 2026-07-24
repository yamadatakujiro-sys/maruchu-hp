const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'guide.html');
  await p.waitForTimeout(400);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'guide-' + (i + 1) + '.png' });
    console.log('wrote guide-' + (i + 1) + '.png');
  }
  await b.close();
})();
