# 画像生成のセットアップ（デザイナー社員に"絵を描くエンジン"を足す）

> 背景（2026-07-13）：デザイナー社員の連携は動くが、環境に画像生成AI（Midjourney/DALL-E/SD等）が
> 無かったため写真クオリティの画像が作れなかった。そこで **Replicate API** を組み込む。
> これで「AI社員が写真クオリティのポスター等を作る」が実現＝商品の実力も上がる。

---

## 何をするか（3ステップ）
1. **Replicate に登録して APIキー（トークン）を取得**（オーナー作業・数分）
2. キーを **Macのオフィスに1ファイルで保存**（コピペ1回）
3. 最新キットを取り込み → デザイナーに再依頼して**写真生成をテスト**

---

## ① Replicate 登録＆APIキー取得（オーナー作業）
1. ブラウザで **replicate.com** を開く →「Sign in」（Google か GitHub でログインが速い）
2. 課金を有効化：**Account → Billing** でクレジットカードを登録
   - 料金は**使った分だけ**。1枚あたり目安 **¥1〜¥30**（モデルによる。Fluxの高画質で¥20前後）。
3. APIトークン発行：**Account → API tokens** →「Create token」→ 表示された **`r8_...` で始まる文字列をコピー**
   - ⚠️ このトークンは**パスワードと同じ**。人に見せない・SNSに貼らない・GitHubに上げない。

## ② キーをMacのオフィスに保存（コピペ1回）
Macのターミナルで、下の `r8_あなたのトークン` を**自分のトークンに置き換えて**実行：
```
printf '%s' 'r8_あなたのトークン' > ~/line-ai-office-test/.image-api-key
chmod 600 ~/line-ai-office-test/.image-api-key
```
- これで `gen-image.mjs` が自動でキーを読み込む（環境変数の設定は不要）。
- このファイルは **.gitignore 済み**なのでGitHubには絶対に上がらない。

## ③ 最新キットを取り込む（Macのキットフォルダで）
```
git pull origin claude/relaxed-wright-7dlibu   # ブランチ名は運用に合わせる
cd ai-office-kit && bash install.sh            # gen-image.mjs が $OFFICE_HOME/bin に配置される
```
※ `install.sh` は社員の CLAUDE.md を雛形から作り直す。カスタムは `roles/` 側に入れる原則（RUNBOOK §A）。

---

## テスト（画像が本当に出るか）
LINEでデザイナーに再依頼するか、動作確認だけなら手動でもよい：
```
node ~/line-ai-office-test/bin/gen-image.mjs \
  --prompt "a cinematic low-angle photo of a stylish man in a white-and-navy sporty tracksuit, orange sneakers, city skyline, blue sky, glossy wet reflective floor" \
  --out ~/Desktop/test.png --model flux-1.1-pro --aspect 9:16
```
`✅ 完成: ...test.png` が出て、デスクトップに画像ができれば成功。

---

## デザイナー社員への頼み方（LINE）
```
デザイナーさんに写真クオリティのポスターを作ってほしいです。
gen-image.mjs で3モデル（flux-1.1-pro / ideogram-v2 / recraft-v3）並列で作って比較してください。
プロンプトは以下です👇
（プロンプト）
```
- デザイナーは長いプロンプトを一旦ファイルに書き出し、`--prompt-file` で渡す（役割定義に明記）。
- 文字（ロゴ）入りは **ideogram / recraft** が崩れにくい。写真は **flux**。

---

## モデルの使い分け（早見表）
| モデル | 得意 | コスト目安 |
|---|---|---|
| `flux-1.1-pro` | 写真クオリティ・最有力 | 高（¥20前後） |
| `flux-dev` | 写真・安価 | 中 |
| `flux-schnell` | 下書き・最速最安 | 極小 |
| `ideogram-v2` | ロゴ・文字が崩れにくい | 中 |
| `recraft-v3` | ポスター・文字＋グラフィック | 中 |

---

## トラブル時
- `APIキーが見つかりません` → ②のファイル保存を確認（パス・中身が1行のトークンか）。
- `401` → トークンが間違い/失効。Replicateで再発行。
- `402` → カード未登録/クレジット不足。Billingを確認。
- ネットに出られない環境（トンネル関係なくMac自体の通信）だと失敗する。通常のMacなら問題なし。

---

## メモ（商品化）
- このキー方式は**顧客ごと**に使える（各オフィスの `.image-api-key` に顧客のキーを置く）。
  画像生成コストを顧客負担にできる（Claude契約と同じ考え方）。
- 既定プロバイダは Replicate。将来 OpenAI画像 / Stability 等を足す場合は `gen-image.mjs` の `MODELS` にモデルを追加する。
