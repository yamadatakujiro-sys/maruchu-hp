const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1260, height: 860 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'gallery.html');
  await p.waitForTimeout(400);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'gallery-' + (i + 1) + '.png' });
    console.log('wrote gallery-' + (i + 1) + '.png');
  }
  await b.close();
})();
