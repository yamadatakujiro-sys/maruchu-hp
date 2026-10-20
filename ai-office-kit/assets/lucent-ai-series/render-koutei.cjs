// Lucent「みんなの工程ボード」体験版のリール（koutei-reel.mp4）とカバー（koutei-cover.png）を書き出す
// 実行： FFMPEG=<ffmpegのパス> NODE_PATH="$(npm root -g)" node render-koutei.cjs
//   元動画：koutei-demo.mp4（1074×2200・30fps・17秒・音なし）
//   重ね用の画面：koutei-reel.html（フォントは bash fetch-fonts.sh koutei-reel.html で作成）
//   中間PNGは koutei-reel-layers/ に毎回作り直し、最後に消す（残したいときは KEEP_LAYERS=1）
// 流れ：①6.5秒のコマを抜く（カバーの地）→ ②Playwright で重ね画像を背景透明の PNG に → ③ffmpeg で重ねて mp4
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname + '/';
const LAYERS = path.join(dir, 'koutei-reel-layers');
const SRC = path.join(dir, 'koutei-demo.mp4');
const OUT = path.join(dir, 'koutei-reel.mp4');
const COVER = path.join(dir, 'koutei-cover.png');

// ffmpeg（H.264 が使えるもの）は環境変数 FFMPEG から読む
const FFMPEG = process.env.FFMPEG;
if (!FFMPEG || !fs.existsSync(FFMPEG)) {
  console.error('環境変数 FFMPEG に ffmpeg のパスを入れてください（H.264 対応の版）。');
  console.error('無ければ： pip install --target ' + dir + ' imageio-ffmpeg');
  console.error('  → FFMPEG=' + dir + 'imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v*（できたファイル名に合わせる）');
  process.exit(1);
}

// 元動画の置き場所（koutei-reel.html の枠の穴と合わせる）：0.49倍 → 526×1078、左上 (277, 528)
const VID = { w: 526, h: 1078, x: 277, y: 528 };

// 字幕の出る時間（秒）。between は両端を含むので、次の字幕と同じコマに2枚出ないよう終わりを 1/60 秒だけ手前にする
const CAPS = [
  { id: 'cap1', a: 0.0, b: 2.5 },   // 外から工程を見るには、／帰るか、電話か。
  { id: 'cap2', a: 2.5, b: 6.0 },   // 「田中さんのハイエース／塗装上がった」
  { id: 'cap3', a: 6.0, b: 9.0 },   // 〈塗装〉→〈組付け〉／車が次の工程へ。
  { id: 'cap4', a: 9.0, b: 13.0 },  // 「佐藤さんのフィット／板金終わった」
  { id: 'cap5', a: 13.0, b: 14.5 }, // 〈板金〉→〈塗装〉
  { id: 'cap6', a: 14.5, b: 17.0 }, // 体験版は、DMで／「ボード」と一言。
];
const DUR = 17;

const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'inherit' });

(async () => {
  // 中間ファイルは毎回作り直す
  fs.rmSync(LAYERS, { recursive: true, force: true });
  fs.mkdirSync(LAYERS, { recursive: true });

  // ① カバーの地：元動画の6.5秒（田中様のハイエースが〈組付け〉に移った直後）のコマ
  ff(['-ss', '6.5', '-i', SRC, '-frames:v', '1', path.join(LAYERS, 'cover-frame.png')]);

  // ② 重ね画像を書き出す（背景透明）
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto('file://' + dir + 'koutei-reel.html');
  await p.evaluate(() => document.body.classList.add('render')); // 確認用の市松模様を消す
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);

  // はみ出しの確認（見出しの右端・下端、字幕の幅、カバーの文字の上下）
  console.log(await p.evaluate(() => {
    const top = (sel) => document.querySelector(sel).getBoundingClientRect();
    const out = [];
    const L = top('#title'), l2 = top('#title .l2'), jp = top('#title .jp'), note = top('#title .note'), en1 = top('#title .en span');
    out.push('見出し ON EVERY PHONE. 右端 x=' + Math.round(l2.right - L.left) + '（右余白 ' + Math.round(L.right - l2.right) + '）');
    out.push('見出し 上端 y=' + Math.round(en1.top - L.top) + ' ／ 日本語 下端 y=' + Math.round(jp.bottom - L.top));
    out.push('WHITEBOARD 右端 x=' + Math.round(en1.right - L.left) + ' ／ 注記 x=' + Math.round(note.left - L.left) + '〜' + Math.round(note.right - L.left));
    for (const id of ['cap1', 'cap2', 'cap3', 'cap4', 'cap5', 'cap6']) {
      const c = top('#' + id + ' .cap'), Lc = top('#' + id);
      out.push(id + '：x ' + Math.round(c.left - Lc.left) + '〜' + Math.round(c.right - Lc.left) + ' ／ y ' + Math.round(c.top - Lc.top) + '〜' + Math.round(c.bottom - Lc.top));
    }
    const C = top('#cover'), t = top('#cover .txt'), cl2 = top('#cover .l2');
    out.push('カバー文字 y ' + Math.round(t.top - C.top) + '〜' + Math.round(t.bottom - C.top) + '（3:4範囲 240〜1680）／ PHONE. 右端 x=' + Math.round(cl2.right - C.left));
    return out.join('\n');
  }));

  for (const id of ['bg', 'title', ...CAPS.map((c) => c.id)]) {
    await p.locator('#' + id).screenshot({ path: path.join(LAYERS, id + '.png'), omitBackground: true });
  }
  // カバーは不透明（6.5秒のコマを暗く敷く）
  await p.locator('#cover').screenshot({ path: COVER });
  await b.close();
  console.log('wrote 重ね画像 → koutei-reel-layers/ ／ koutei-cover.png');

  // ③ ffmpeg で重ねる：暗い色の地 → 縮めた元動画 → 地（枠・穴あき）→ 見出し → 字幕（時間で切り替え）
  const inputs = [
    '-f', 'lavfi', '-i', `color=c=0x111111:s=1080x1920:r=30:d=${DUR}`, // [0] 下地
    '-i', SRC, // [1] 元動画
    '-i', path.join(LAYERS, 'bg.png'), // [2] 地（穴あき）
    '-i', path.join(LAYERS, 'title.png'), // [3] 見出し
    ...CAPS.flatMap((c) => ['-i', path.join(LAYERS, c.id + '.png')]), // [4]〜[9] 字幕
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', // [10] 無音
  ];
  // 静止画1枚の入力は overlay が最後のコマを出し続ける（eof_action=repeat）ので -loop は要らない
  let fc = `[1:v]scale=${VID.w}:${VID.h}:flags=lanczos,setsar=1,fps=30[demo];` +
    `[0:v][demo]overlay=${VID.x}:${VID.y}[s0];` +
    `[s0][2:v]overlay=0:0[s1];` +
    `[s1][3:v]overlay=0:0[s2];`;
  CAPS.forEach((c, i) => {
    const end = c.b >= DUR ? DUR : (c.b - 1 / 60).toFixed(4);
    fc += `[s${i + 2}][${i + 4}:v]overlay=0:0:enable='between(t,${c.a},${end})'[s${i + 3}];`;
  });
  fc += `[s${CAPS.length + 2}]format=yuv420p[v]`;
  const audioIdx = 4 + CAPS.length;
  ff([...inputs, '-filter_complex', fc, '-map', '[v]', '-map', `${audioIdx}:a`,
    '-t', String(DUR), '-r', '30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', OUT]);
  console.log('wrote koutei-reel.mp4');

  // 中間ファイルを消す（残すのは最終成果物と元データだけ）
  if (!process.env.KEEP_LAYERS) fs.rmSync(LAYERS, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
