// Lucent ライト入荷（10/19）の投稿サムネを書き出す（1080×1350・Instagram縦長4:5、2倍で2160×2700）
// 実行： NODE_PATH="$(npm root -g)" node render-lights.cjs
// 写真は lights-photo.jpg、フォントは fonts/（bash fetch-fonts.sh lights.html で作成）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'lights.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  // 1行目（LOADED WITH）が右端で切れていないか幅を確かめる
  console.log(await p.evaluate(() => { const r = document.querySelector('.l1').getBoundingClientRect(), s = document.querySelector('.slide').getBoundingClientRect(); return 'LOADED WITH 右端: ' + Math.round(r.right - s.left) + 'px / 1080px（右余白 ' + Math.round(s.right - r.right) + 'px）'; }));
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'lights-' + (i + 1) + '.png' });
    console.log('wrote lights-' + (i + 1) + '.png');
  }
  await b.close();
})();
