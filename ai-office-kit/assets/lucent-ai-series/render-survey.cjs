// アンケート素材を書き出す
// フィード 1080×1350（4:5）／ストーリーズ 1080×1920（9:16）
// ⚠️HTMLを増やすときは jobs に1行足すだけ。out は既存と被らない接頭辞にする
const { chromium } = require('playwright');

const jobs = [
  // 鈑金屋・整備士向け（第1弾）
  { html: 'survey-feed.html',       sel: '.slide', out: 'q-feed-',  w: 1140, h: 1400 },
  { html: 'survey-story.html',      sel: '.st',    out: 'q-story-', w: 1140, h: 1980 },
  // 流通側＝中古部品商・新品部品商・材料屋向け（第2弾）
  { html: 'survey-feed-parts.html', sel: '.slide', out: 'q2-feed-', w: 1140, h: 1400 },
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
      const name = j.out + (i + 1) + '.png';
      await els[i].screenshot({ path: dir + name });
      console.log('wrote ' + name);
    }
    await page.close();
  }

  await b.close();
})();
