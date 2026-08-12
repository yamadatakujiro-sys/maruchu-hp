# 画像・動画素材の索引（どれをどこで使うか）

> ⚠️ **フォルダ名が似ていて取り違えやすい。使う前にこの表を見る。**
> 実際に事故った例（2026-08-12）：**ココナラ用の横長画像をInstagramに上げて左右が切れた。**
> サイズ設定のミスではなく、**別の用途の画像を入れてしまった**のが原因。

## 使い分け一覧

| フォルダ | サイズ | 比率 | 使う場面 | 状態 |
|---|---|---|---|---|
| **`instagram-launch/`** | 2160×2700 | **4:5 縦長** | **Instagram（出品告知）**・Xに添える1枚目 | ✅**現行** |
| **`coconala-starter/`** | 2400×1600 | **3:2 横長** | **ココナラ出品ページ**（サムネ＋ギャラリー4枚） | ✅**現行** |
| **`onboarding-video/`** | 1920×1080 | 16:9 | **使い方ガイド動画**（＋商談資料に流用可） | ✅**現行** |
| `line-setup-guide/` | — | — | 公式LINE作成の手順図解（LINE版の作業用） | 参考 |
| `instagram-monitor/` | 1080×1350 | 4:5 | **旧LINE版のモニター告知** | ❌**使わない** |
| `coconala-thumbnail/` | — | — | **旧LINE版のココナラ素材**（月額¥9,800表記が残っている） | ❌**使わない** |

## 迷ったときの判断

| やりたいこと | 使うもの |
|---|---|
| Instagramに投稿する | **`instagram-launch/ig-1〜4.png`**（この順で選ぶ＝カルーセルの順番） |
| Xに投稿する | 文＋**`instagram-launch/ig-1.png`** を1枚添える |
| ココナラの出品画像を差し替える | `coconala-starter/thumbnail.png` ＋ `gallery-1〜4.png` |
| 動画を作り直す | `onboarding-video/`（`slides.html` を直して `render.cjs` → `build.sh`） |
| 商談で説明資料が欲しい | `onboarding-video/slide-*.png`（17枚・そのまま説明資料になる） |

## Macでフォルダを開く

```bash
cd ~/maruchu-hp && git pull origin claude/relaxed-wright-7dlibu
open ai-office-kit/assets/instagram-launch     # Instagram用
open ai-office-kit/assets/coconala-starter     # ココナラ用
```

## 比率を確認するコマンド（作り直したとき）

```bash
cd ~/maruchu-hp/ai-office-kit/assets
python3 -c "
from struct import unpack; import glob,os
for p in sorted(glob.glob('*/*.png')):
    w,h=unpack('>II', open(p,'rb').read(24)[16:24])
    print(f'{p:50} {w}x{h}  比率{w/h:.3f}')"
```

**目安**：Instagram縦長＝**0.800**／ココナラ＝1.500／動画＝1.778

## 配色のルール（重要）

⚠️ **LINEを使わない商品（スタートキット）の素材に、LINEグリーンを使わない。**
緑にすると「LINEのサービス？」と読まれる。**過去に実際にオーナー自身が誤解した。**

| 商品 | 配色 |
|---|---|
| スタートキット（Claudeアプリで使う） | **紺 `#0a1c33` ＋ 青 `#2a6db0` ＋ アンバー `#f0b429`** |
| LINE版（実際にLINEを使う） | LINEグリーン可 |

> ⚠️ 現状 `coconala-starter/` にはLINE版から流用した**緑が残っている**（文言は修正済み）。
> `instagram-launch/` と並べると印象がズレるため、**紺系に揃え直すのが望ましい**（未対応）。
