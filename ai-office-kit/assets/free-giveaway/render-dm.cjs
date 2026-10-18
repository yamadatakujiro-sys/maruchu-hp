// DM用の別版（kyujin-dm.html）を書き出す → kyujin-dm-1.png（手順）・kyujin-dm-2.png（見本）
// 実行： NODE_PATH="$(npm root -g)" node render-dm.cjs
// ⚠️配達先用の kyujin.html／kyujin.pdf／kyujin-1.png／kyujin-2.png は render.cjs の担当。こちらでは触らない（PDFも出さない）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1300, height: 1800 }, deviceScaleFactor: 2 });
  await page.goto('file://' + dir + 'kyujin-dm.html');
  await page.waitForTimeout(400);
  const els = await page.$$('.a4');
  for (let i = 0; i < els.length; i++) {
    const name = 'kyujin-dm-' + (i + 1) + '.png';
    await els[i].screenshot({ path: dir + name });
    console.log('wrote ' + name);
  }
  await b.close();
})();
