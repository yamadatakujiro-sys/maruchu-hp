# 成果物画像をLINEに"実物表示"する（line-harness R2 方式）

> 背景（2026-07-18 更新）：完成報告が「テキスト＋ファイルパス」だけだと、オーナーは `open` しないと
> 中身を見られない。**商品として売る時も「LINEの画面に実物の画像が出ている」方が圧倒的に分かりやすい**
> （顧客がファイル場所を知らなくても成果物が見える）。`bin/send-line-image.mjs` でこれを自動化する。
> **外部サービス（imgbb等）の登録は不要**——line-harness が既に持つ **R2** をそのまま使う。

---

## 仕組み（なぜ2段階か）
LINE は push メッセージに**ローカルのファイルを直接添付できない**。必ず「公開HTTPS URL」が要る。
そこで本ツールは：
1. 画像を **line-harness の R2**（`POST /api/images`・バイナリ直送）にアップ → 公開URLを取得
2. その URL で **LINE Messaging API の画像メッセージ**を push 送信

---

## 必要な環境変数（秘密情報。コミット禁止）
| 変数 | 用途 | 置き場所 |
|---|---|---|
| `LINE_HARNESS_API_URL` | line-harness Worker の URL | `com.lineaioffice.bridge.plist` の EnvironmentVariables |
| `LINE_HARNESS_API_KEY` | line-harness Admin API キー（R2アップロード認証） | 同上 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 送信するLINE公式アカウントのチャネルアクセストークン | 環境変数 or `$OFFICE_HOME/.line-channel-token` |

- `LINE_HARNESS_API_URL` / `LINE_HARNESS_API_KEY` を bridge の plist に入れておけば、**bridge 経由で
  spawn される社員セッションが自動でこれを引き継ぐ**（毎回の手設定は不要）。
- `.line-channel-token` は **.gitignore 済み**なのでGitHubには絶対に上がらない。

---

## デザイナー等の自動化（役割定義に組み込み済み）
`roles/designer.md` の「成果物の完成報告」に、`send-line-image.mjs` で画像もLINEに送る手順を明記。
これにより、**完成のたびに「テキスト報告＋実物画像」がLINEに自動で並ぶ**。キー未設定等でエラーの時のみ、
従来の `open "<絶対パス>"` 付きテキストにフォールバックする。

---

## テスト（LINEに画像が出るか）
`<friendId>` は自分（オーナー）の friendId。
```
node "$OFFICE_HOME/bin/send-line-image.mjs" \
  --image <成果物の絶対パス> \
  --to <あなたのfriendId> \
  --caption "テスト送信です"
```
`✅ LINEに画像を送信しました。` が出て、LINEトークに画像が表示されれば成功。

---

## トラブル時
- `LINE_HARNESS_API_URL または LINE_HARNESS_API_KEY が未設定` → bridge plist の EnvironmentVariables を確認。
- `R2アップロード認証エラー（401）` → `LINE_HARNESS_API_KEY` が違う／失効。line-harness 側で再確認。
- `LINEチャネルアクセストークンが無効（401）` → `LINE_CHANNEL_ACCESS_TOKEN` を送りたいOAのものに。
- `LINE送信失敗（400）` → `--to` の friendId が違う、または画像URLにLINEが到達できない。
- 画像が大きすぎる → 原寸は10MB・プレビューは1MBが上限。通常のポスター（1〜3MB）は問題なし。

---

## メモ（商品化）
- **追加の画像ホスティングは不要**（line-harness の R2 を再利用）。顧客ごとの外部アカウント作成が要らない＝導入が軽い。
- 別の保存先（S3等）に替える場合は `send-line-image.mjs` の `uploadToR2()` を差し替える（戻り値＝公開URL文字列を合わせる）。
