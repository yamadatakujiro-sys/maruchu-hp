# 案内PDF｜ホワイトボードを、スマホへ。（静岡の社長＝望月オート向け）

> **これは「こんなことができますよ」の案内**（提案書・見積ではない）。
> オーナー（タツヤ）が社長に送る用。**会社名・氏名・金額は入れない。**

## 何のPDFか
社長の困りごと＝**ホワイトボードで納車/工程を管理していて会社でしか見えない**（外に出ると帰社or電話）。
それを**スマホでみんな共有**できるようにする案内。女性職人さんが多い会社なので**かわいい・分かりやすい**にした。

## ページ構成（A4縦・6ページ）
1. 表紙「ホワイトボードを、スマホへ。」
2. 今こう（会社でしか見えない困りごと）
3. ★主役＝スマホで見る共有ボード（**Googleスプレッドシート**）
4. さらにラク＝**LINEで話しかけるだけ**でボードが動く
5. さらに安心＝AIが**先回りで通知**（納期遅れ・納車の被り）
6. おまけ＝他にもできること（写真で目安/保険の文の下書き/日報/納車前日通知/部品リマインド）＋しめ

## 方針（守っていること）
- 主役はホワイトボード→共有ボード（困ってるのがそこ）。6個は"参考程度"で細かい説明はしない。
- **金額を載せない。** 写真は「だいたいの目安まで（正確なのは見てから）」、保険は「文の下書きを手伝う」＝盛らない。
- **専門用語（API等）はPDFに出さない。** LINEの緑はLINEを描くときだけ。

## 素材
| ファイル | 用途 |
|---|---|
| **`annai.pdf`** | ★社長に送る本体（A4・6ページ） |
| `annai-1.png`〜`annai-6.png` | 各ページ画像（LINE/DMで送る用） |
| `annai.html` | 元データ。文言・イラストを直して `render.cjs` で再生成 |
| `render.cjs` | HTML→PNG＋PDF（Playwright chromium、300dpi相当） |

## 作り直す
```bash
cd ~/maruchu-hp/ai-office-kit/assets/whiteboard-annai
NODE_PATH="$(npm root -g)" node render.cjs
```
⚠️各ページがはみ出していないか確認（over=0 ならOK）：
```bash
NODE_PATH="$(npm root -g)" node -e "
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1240, height: 1754 } });
  await p.goto('file:///home/user/maruchu-hp/ai-office-kit/assets/whiteboard-annai/annai.html');
  await p.waitForTimeout(400);
  console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('.a4')].map((a,i)=>({page:i+1,over:Math.round(a.scrollHeight-a.clientHeight)})))));
  await b.close(); })();"
```
