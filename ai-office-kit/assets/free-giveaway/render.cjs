// 無料配布物を書き出す（A4 1枚・1240×1754＝150dpi／印刷可）
// ⚠️deviceScaleFactor 2 で 2480×3508＝300dpi 相当。印刷しても粗くならない
const { chromium } = require('playwright');

const jobs = [
  { html: 'kyujin.html', sel: '.a4', out: 'kyujin', w: 1300, h: 1800 },
];

(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();

  for (const j of jobs) {
    const page = await b.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 2 });
    await page.goto('file://' + dir + j.html);
    await page.waitForTimeout(400);
    const els = await page.$$(j.sel);
    for (let i = 0; i < els.length; i++) {
      const name = els.length === 1 ? j.out + '.png' : j.out + '-' + (i + 1) + '.png';
      await els[i].screenshot({ path: dir + name });
      console.log('wrote ' + name);
    }
    // 印刷用PDF（配達先で紙で渡す用。コンビニでそのまま印刷できる）
    await page.pdf({ path: dir + j.out + '.pdf', format: 'A4', printBackground: true });
    console.log('wrote ' + j.out + '.pdf');
    await page.close();
  }

  await b.close();
})();
