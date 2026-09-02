// 提案資料を書き出す（16:9・1280×720／スライド1枚=PDF1ページ）
// ⚠️deviceScaleFactor 2 で 2560×1440 相当。画面でもきれい。
// 各 .slide を1枚ずつPNGにし、まとめてPDF(annai.pdf)も出す。
// ★PDFは format ではなく width/height をスライドに合わせる（＝余白ページが出ない）。
const { chromium } = require('playwright');

const jobs = [
  { html: 'annai.html', sel: '.slide', out: 'annai', w: 1280, h: 720 },
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
    // スライド寸法にぴったり合わせたPDF（1スライド=1ページ・余白なし）
    await page.pdf({
      path: dir + j.out + '.pdf',
      width: j.w + 'px', height: j.h + 'px',
      printBackground: true, pageRanges: '1-' + els.length,
    });
    console.log('wrote ' + j.out + '.pdf');
    await page.close();
  }

  await b.close();
})();
