// スタートキット用のココナラ素材を書き出す（サムネ1枚＋ギャラリー4枚）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();

  // サムネ 1200×800
  const p1 = await b.newPage({ viewport: { width: 1260, height: 860 }, deviceScaleFactor: 2 });
  await p1.goto('file://' + dir + 'thumbnail.html');
  await p1.waitForTimeout(400);
  const card = await p1.$('.stage');
  await card.screenshot({ path: dir + 'thumbnail.png' });
  console.log('wrote thumbnail.png');

  // ギャラリー（各 .slide）
  const p2 = await b.newPage({ viewport: { width: 1260, height: 860 }, deviceScaleFactor: 2 });
  await p2.goto('file://' + dir + 'gallery.html');
  await p2.waitForTimeout(400);
  const slides = await p2.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'gallery-' + (i + 1) + '.png' });
    console.log('wrote gallery-' + (i + 1) + '.png');
  }
  await b.close();
})();
