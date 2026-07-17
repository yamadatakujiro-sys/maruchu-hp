# LINE画像送信のセットアップ（成果物をLINE画面に"実物表示"する）

> 背景（2026-07-17）：デザイナー社員がポスター等を作れるようになったが、完成報告が
> 「テキスト＋ファイルパス」だけだと、オーナーは `open` しないと中身を見られない。
> **商品として売る時も「LINEの画面に実物の画像が出ている」方が圧倒的に分かりやすい。**
> そこで **`send-line-image.mjs`** を追加し、完成画像を自動でLINEに"画像"として送れるようにする。

---

## 仕組み（なぜ2段階か）
LINE は push メッセージに**ローカルのファイルを直接添付できない**。必ず「公開HTTPS URL」が要る。
そこで本ツールは：
1. 画像を **imgbb（無料の画像ホスティング）** にアップ → 公開URLを取得
2. その URL で **LINE Messaging API の画像メッセージ**を push 送信

---

## 何をするか（3ステップ）
1. **imgbb の無料APIキー**を取得（数分）
2. **LINE公式アカウントのチャネルアクセストークン**を取得（LINE Developers）
3. 2つのキーを **Macのオフィスに保存** → テスト送信

---

## ① imgbb APIキーを取得（無料）
1. ブラウザで **https://imgbb.com/** を開き、無料アカウント作成（Googleログイン可）
2. **https://api.imgbb.com/** を開く →「Get API key」→ 表示された**キー文字列をコピー**
   - ⚠️ このキーは秘密情報。人に見せない・SNSやGitHubに貼らない。

## ② LINEチャネルアクセストークンを取得
1. **https://developers.line.biz/console/** を開く（LINEログイン）
2. 画像を**送りたい公式アカウント（例：leader）**のチャネルを開く
3. **Messaging API** タブ →「チャネルアクセストークン（長期）」を発行 → **文字列をコピー**
   - ⚠️ これも秘密情報（パスワード同等）。絶対に共有しない。

## ③ キーをMacのオフィスに保存（コピペ）
Macのターミナルで、下の値を**自分のキーに置き換えて**実行（`OFFICE_HOME` は運用に合わせる）：
```
printf '%s' 'あなたのimgbbキー'      > ~/line-ai-office/.imgbb-api-key
printf '%s' 'あなたのLINEトークン'   > ~/line-ai-office/.line-channel-token
chmod 600 ~/line-ai-office/.imgbb-api-key ~/line-ai-office/.line-channel-token
```
- `send-line-image.mjs` が自動でこの2ファイルを読み込む（環境変数でも可：`IMGBB_API_KEY` / `LINE_CHANNEL_ACCESS_TOKEN`）。
- 両ファイルとも **.gitignore 済み**なのでGitHubには絶対に上がらない。

## ④ 最新キットを取り込む（Macのキットフォルダで）
```
git pull origin claude/relaxed-wright-7dlibu   # ブランチ名は運用に合わせる
cd ai-office-kit && bash install.sh            # send-line-image.mjs が $OFFICE_HOME/bin に配置される
```

---

## テスト（LINEに画像が出るか）
`<friendId>` は自分（オーナー）の friendId。デザイナーの会話ログや line-harness の
`get_conversation` で確認できる。
```
node ~/line-ai-office/bin/send-line-image.mjs \
  --image ~/line-ai-office/members/member-designer/projects/lucent-poster-v3/poster-lucent-v3.png \
  --to <あなたのfriendId> \
  --caption "テスト送信です"
```
`✅ LINEに画像を送信しました。` が出て、LINEトークに画像が表示されれば成功。

---

## デザイナー社員の自動化（役割定義に組み込み済み）
`roles/designer.md` に「成果物が完成したら `send-line-image.mjs` で画像もLINEに送る」を明記。
これにより、以後は**完成のたびに「テキスト報告＋実物画像」がLINEに自動で並ぶ**。

---

## トラブル時
- `LINEチャネルアクセストークンが見つかりません` → ③のファイル保存を確認（1行・余計な改行なし）。
- `imgbbアップロード失敗（400）` → imgbbキーが間違い/未取得。①をやり直す。
- `LINE送信失敗（400）` → `--to` の friendId が違う、または画像URLにLINEが到達できない。
- `401`（LINE） → トークンが失効/別チャネル。②で再発行し、送りたいOAのものか確認。
- 画像が大きすぎる → 原寸は10MB・プレビューは1MBが上限。通常のポスター（1〜3MB）は問題なし。

---

## メモ（商品化）
- このキー方式は**顧客ごと**に使える（各オフィスの `.imgbb-api-key` / `.line-channel-token` に顧客のキーを置く）。
- 画像ホスティングは既定 imgbb。将来 Cloudinary / S3 等に替える場合は
  `send-line-image.mjs` の `uploadToImgbb()` を差し替える（返り値 `{ original, preview }` を合わせる）。
