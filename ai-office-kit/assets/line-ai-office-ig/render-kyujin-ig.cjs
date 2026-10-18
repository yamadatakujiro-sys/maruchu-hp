// @line_ai_office「求人原稿は、質問に答えるだけ。」カルーセルを書き出す（1080×1350・Instagram縦長4:5 → 2160×2700）
// 実行： bash fetch-fonts.sh kyujin-ig.html && NODE_PATH="$(npm root -g)" node render-kyujin-ig.cjs
// フォントは fonts/*-kyujin-ig.ttf → kyujin-ig-1〜6.png を1→6の順で投稿
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'kyujin-ig.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'kyujin-ig-' + (i + 1) + '.png' });
    console.log('wrote kyujin-ig-' + (i + 1) + '.png');
  }
  await b.close();
})();
