// @line_ai_office「インスタの投稿、スマホでこう頼んでいます。」カルーセルを書き出す（1080×1350・Instagram縦長4:5）
// 実行： bash fetch-fonts.sh phone.html && NODE_PATH="$(npm root -g)" node render-phone.cjs
// 画像は phone-shot-*.png（スクショの切り出し）と ../lucent-ai-series/buy2-1.png（完成品）、フォントは fonts/*-phone.ttf
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'phone.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'phone-' + (i + 1) + '.png' });
    console.log('wrote phone-' + (i + 1) + '.png');
  }
  await b.close();
})();
