// 案内PDFを書き出す（A4縦・6ページ／1240×1754＝150dpi）
// ⚠️deviceScaleFactor 2 で 2480×3508＝300dpi 相当。印刷しても粗くならない。
// 各 .a4 を1枚ずつPNGにし、まとめて A4 のPDF(annai.pdf)も出す。
const { chromium } = require('playwright');

const jobs = [
  { html: 'annai.html', sel: '.a4', out: 'annai', w: 1240, h: 1754 },
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
    // 送付・印刷用のPDF（A4・背景色ごと）
    await page.pdf({ path: dir + j.out + '.pdf', format: 'A4', printBackground: true });
    console.log('wrote ' + j.out + '.pdf');
    await page.close();
  }

  await b.close();
})();
