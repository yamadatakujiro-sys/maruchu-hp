# 提案資料｜ホワイトボードを、スマホへ。（静岡の社長＝望月オート向け）

> **社長へのプレゼン用資料**（「AIでこんなことができます」のご提案）。
> オーナー（タツヤ）が社長に見せる／送る用。**会社名・氏名・金額は入れない。**

## トーン
**しっかりしたビジネス資料**（16:9・プレゼン形式）。ただし分かりやすく。
※初版は「かわいい版(A4)」だったが、オーナー判断で**普通のプレゼン資料に作り直し**。

## スライド構成（16:9・全9枚）
1. 表紙「ホワイトボードを、スマホへ。」
2. 現状の課題（事務所でしか進捗が見えない）
3. 解決の全体像（3ステップ）
4. STEP1 スマホで共有ボード（**Googleスプレッドシート**・工程表）
5. STEP2 LINEで更新（話しかけるだけ→AI判断→自動反映）
6. STEP3 先回り通知（納期遅れ・納車重複を検知）
7. その他の活用例（写真で目安/保険文面/日報/前日リマインド/部品通知）
8. 導入イメージ（小さく始めて段階的に）
9. まとめ（見える・ラクになる・見落とさない／ご相談ください）

## 方針（守っていること）
- 主役はホワイトボード→共有ボード（課題がそこ）。活用例(6)は段階的な広がりとして提示。
- **金額を載せない。** 写真は「目安（正確は現車確認後）」、保険は「文面作成の支援」＝盛らない。
- **専門用語（API等）はスライドに出さない。** LINEの緑はLINEを描くときだけ。
- フォントは **IPAPゴシック**（環境にある標準ゴシック。中国語フォント化けを回避）。

## 素材
| ファイル | 用途 |
|---|---|
| **`annai.pdf`** | ★社長に送る本体（16:9・9スライド・1枚=1ページ） |
| `annai-1.png`〜`annai-9.png` | 各スライド画像（LINE/メールで送る用・2560×1440相当） |
| `annai.html` | 元データ。文言・図を直して `render.cjs` で再生成 |
| `render.cjs` | HTML→PNG＋PDF（Playwright chromium。PDFはスライド寸法に合わせ余白ページ無し） |

## 作り直す
```bash
cd ~/maruchu-hp/ai-office-kit/assets/whiteboard-annai
NODE_PATH="$(npm root -g)" node render.cjs
```
⚠️各スライドがはみ出していないか確認（over=0 ならOK）：
```bash
NODE_PATH="$(npm root -g)" node -e "
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('file:///home/user/maruchu-hp/ai-office-kit/assets/whiteboard-annai/annai.html');
  await p.waitForTimeout(400);
  console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('.slide')].map((a,i)=>({s:i+1,over:Math.round(a.scrollHeight-a.clientHeight)})))));
  await b.close(); })();"
```
