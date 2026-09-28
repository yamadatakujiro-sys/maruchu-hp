// @line_ai_office「店のインスタ投稿を、一言頼んで作りました。」カルーセルを書き出す（1080×1350・Instagram縦長4:5）
// 実行： bash fetch-fonts.sh ichigen.html && NODE_PATH="$(npm root -g)" node render-ichigen.cjs
// 画像は ../lucent-ai-series/arrival-1.png（完成品）と arrival-photo.webp（送った写真）、フォントは fonts/*-ichigen.ttf
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('file://' + dir + 'ichigen.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const slides = await p.$$('.slide');
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: dir + 'ichigen-' + (i + 1) + '.png' });
    console.log('wrote ichigen-' + (i + 1) + '.png');
  }
  await b.close();
})();
