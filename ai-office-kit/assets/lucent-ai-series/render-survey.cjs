// アンケート素材を書き出す
// フィード 1080×1350（4:5）／ストーリーズ 1080×1920（9:16）
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname + '/';
  const b = await chromium.launch();

  const pf = await b.newPage({ viewport: { width: 1140, height: 1400 }, deviceScaleFactor: 2 });
  await pf.goto('file://' + dir + 'survey-feed.html');
  await pf.waitForTimeout(400);
  const feed = await pf.$$('.slide');
  for (let i = 0; i < feed.length; i++) {
    await feed[i].screenshot({ path: dir + 'q-feed-' + (i + 1) + '.png' });
    console.log('wrote q-feed-' + (i + 1) + '.png');
  }

  const ps = await b.newPage({ viewport: { width: 1140, height: 1980 }, deviceScaleFactor: 2 });
  await ps.goto('file://' + dir + 'survey-story.html');
  await ps.waitForTimeout(400);
  const st = await ps.$$('.st');
  for (let i = 0; i < st.length; i++) {
    await st[i].screenshot({ path: dir + 'q-story-' + (i + 1) + '.png' });
    console.log('wrote q-story-' + (i + 1) + '.png');
  }
  await b.close();
})();
