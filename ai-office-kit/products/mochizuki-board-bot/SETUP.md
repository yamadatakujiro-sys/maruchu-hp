# 立ち上げ手順（Mac ＋ cloudflared ／ まずはオーナー名義）

> この通りに上から順にやれば、**LINEに打つと工程ボード（Googleスプレッドシート）が動く**ところまで行く。
> 今回は「まずオーナー（タツヤ）名義・Mac＋cloudflaredトンネル」で立ち上げる。本番でクラウド／クライアント名義へ移す道筋は最後に。
> つまずいたら「困ったとき」節へ。所要：初回でだいたい1〜1.5時間。

---

## 0. 用意するもの（アカウント）
すべて**オーナー名義**でOK（テスト用）。
- Googleアカウント（スプレッドシート＋Google Cloud）
- LINEアカウント（LINE Developers に登録）
- Anthropicアカウント（console.anthropic.com＝APIキー用。Claude CodeのPro/Maxとは別物）
- Mac（このBotを動かす）＋ `cloudflared`（トンネル）＋ Node 18以上

Nodeの確認：
```bash
node --version   # v18 以上ならOK（推奨 v20+）
```
`cloudflared` が無ければ：
```bash
brew install cloudflared
```

このBotのフォルダへ移動しておく：
```bash
cd <このリポジトリ>/ai-office-kit/products/mochizuki-board-bot
node scripts/selftest.mjs   # ✅ 全件パス と出ればコードは正常
```

---

## 1. Google スプレッドシートを用意
1. Googleスプレッドシートを新規作成。名前は「望月オート 工程ボード」など。
2. 左下のシートタブ名を **`工程ボード`** に変更（この名前が重要）。
3. URLの `/d/` と `/edit` の間が **スプレッドシートID**。控える。
   例：`https://docs.google.com/spreadsheets/d/`**`ここがID`**`/edit`

## 2. Google Cloud でサービスアカウントを作る（Botがシートを触るための鍵）
1. https://console.cloud.google.com/ → プロジェクトを新規作成（例：`mochizuki-board`）。
2. 「APIとサービス」→「ライブラリ」→ **Google Sheets API** を検索して**有効化**。
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→ **サービスアカウント**。
   - 名前：`board-bot` など → 作成して完了（権限付与はスキップでOK）。
4. 作ったサービスアカウントを開く →「キー」タブ →「鍵を追加」→「新しい鍵」→ **JSON** → ダウンロード。
5. ダウンロードしたJSONを開くと、次の3つがある：
   - `project_id`（参考）
   - `client_email` … 例 `board-bot@mochizuki-board.iam.gserviceaccount.com`
   - `private_key` … `-----BEGIN PRIVATE KEY-----\n...` の長い文字列
6. **スプレッドシートをこのサービスアカウントに共有**：
   スプレッドシート右上「共有」→ 上の `client_email` を貼って **「編集者」** で共有。
   （これをしないとBotが書き込めない＝一番ハマるところ）

## 3. Anthropic APIキー（Botの頭脳＝Claude）
1. https://console.anthropic.com/ → API Keys → 新規発行。
2. `sk-ant-...` を控える。少額チャージしておく（Haikuは安い）。

## 4. LINE 公式アカウント＋Messaging API
1. https://developers.line.biz/ にLINEでログイン → プロバイダーを作成（例：望月オート）。
2. 「新規チャネル作成」→ **Messaging API** を選択 → 会社名等を入力して作成。
3. **「Messaging API設定」タブ**：
   - **チャネルアクセストークン（長期）** を発行 → 控える。
   - 「チャネルシークレット」は**「チャネル基本設定」タブ**にある → 控える。
4. **応答設定**（同タブ or LINE Official Account Manager）：
   - **Webhook：オン**
   - **あいさつメッセージ：オフ** / **応答メッセージ：オフ**（Botの返事とぶつかるため）
   - **グループ・複数人トークへの参加を許可：オン**（社員グループに入れるため）

---

## 5. .env を作る
```bash
cp .env.example .env
```
`.env` を開いて、ここまでで控えた値を貼る：
- `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`
- `ANTHROPIC_API_KEY`
- `GOOGLE_SHEET_ID`（手順1）
- `GOOGLE_CLIENT_EMAIL`（手順2の `client_email`）
- `GOOGLE_PRIVATE_KEY`（手順2の `private_key` を**そのまま**ダブルクォートで囲んで貼る）
  - JSON内の `private_key` は既に `\n` 入りの1行なので、**その1行をコピーして** `"..."` で囲むだけ。
  - 例：`GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`

## 6. シートに枠とサンプルを入れる
```bash
node scripts/init-sheet.mjs --sample
```
→ スプレッドシートにヘッダ（ID/お客様/車種/…）とサンプル車が入る。
うまくいかない時はコマンドが原因（タブ名・共有・ID）を教えてくれる。

## 7. Botを起動＋トンネルを開く（ターミナル2枚）
**ターミナルA**（Bot本体）：
```bash
node src/server.mjs
# → 工程ボードBot 起動: http://127.0.0.1:18790
```
**ターミナルB**（公開トンネル）：
```bash
cloudflared tunnel --url http://localhost:18790
# → https://xxxx-xxxx.trycloudflare.com のような公開URLが出る
```
この**公開URL + `/webhook`** が Webhook URL。
例：`https://xxxx-xxxx.trycloudflare.com/webhook`

## 8. LINEにWebhook URLを設定
1. LINE Developers →「Messaging API設定」→ **Webhook URL** に上のURL（末尾 `/webhook`）を入れて更新。
2. 「検証」ボタン → **成功** すればOK（Botが起動中＆トンネルが開いていること）。

## 9. テスト（1:1）
1. 「Messaging API設定」のQRコードから、Botを**友だち追加**。
2. トークで送ってみる：
   - `田中さんのハイエース 塗装終わった` → 「✅ 田中様のハイエース〈塗装〉→〈組付け〉に動かしました」
   - スプレッドシートの田中さんの行の工程が **組付け** に変わる。
   - `今どうなってる？` → 工程ごとの一覧が返る。
   - `渡辺さんのプリウス 板金始めた` → 板金へ。
3. ターミナルAのログに `[recv] user target=Uxxxx ...` が出る。この `Uxxxx` が自分のユーザーID。

## 10. 先回り通知を試す
1. まず送信先を決める。テストなら手順9で出た自分の `Uxxxx` を `.env` の `NOTIFY_TARGET` に。
   （本番は「会社のグループ」に入れて、そのグループIDを使う＝下記）
2. 中身の確認（送らない）：
```bash
node bin/notify.mjs --dry
```
3. 実際に送る：
```bash
node bin/notify.mjs
```
→ 「納車被り」「遅れ」「本日納車」がまとまってLINEに届く。
   （同じ内容は連投しない。`--force` で強制送信）

### グループで使う場合の通知先ID
1. 会社の（テスト用）グループを作り、**Botを招待**。
2. グループで一言送ると、ターミナルAに `[recv] group target=Cxxxx ...` が出る。
3. その `Cxxxx` を `.env` の `NOTIFY_TARGET` に設定 → 以後グループへ通知。

## 11. 先回り通知を毎朝自動で（任意）
Macの `crontab` で朝8時に回す例：
```bash
crontab -e
# 追記（パスは自分の環境に合わせる）
0 8 * * * cd /Users/あなた/.../mochizuki-board-bot && /usr/local/bin/node bin/notify.mjs >> .state/notify-cron.log 2>&1
```
（Macがスリープだと動かない点だけ注意。常時ONにするか、本番はクラウドへ。）

---

## 訪問デモの回し方（来週）
1. 事前に手順9まで通しておく（サンプル入りで動く状態）。
2. 現地で社長のスマホからBotにLINEを送ってもらう →「喋る/打つ→表が動く」を体感。
3. `node bin/notify.mjs --force` で先回り通知を実演。
4. 実際の工程名・車の呼び方を聞けたら、`config/board.config.json` の `stages` を差し替え＋シートを実データに更新すれば“自分ごと”に。

## 本番へ（テストがOKになったら）
- **常時稼働**：Mac常駐（`launchd`）か、クラウド（Render/Railway/Fly 等）へ。コードはそのまま動く（`PORT` を環境変数で渡すだけ）。
- **相手名義へ**：LINE公式・Google・Anthropicキーを**クライアント名義で作り直して** `.env` を差し替え → 完全売り切り。
- **固定Webタイトル**：trycloudflareのURLは起動ごとに変わる。本番は固定ドメイン（Cloudflare Tunnelの名前付きトンネル or クラウドのURL）にしてLINE Webhookを固定する。

---

## 困ったとき
- **LINEの「検証」が失敗** → Bot(ターミナルA)が起動中か／トンネル(B)が生きているか／URL末尾が `/webhook` か。
- **返事は来るがシートが変わらない** → サービスアカウントに**編集者で共有**したか（手順2-6）／タブ名が `工程ボード` か／`GOOGLE_SHEET_ID` 違い。
- **`Google トークン取得失敗`** → `GOOGLE_PRIVATE_KEY` の貼り方（`\n`込みで丸ごと、ダブルクォート）／`GOOGLE_CLIENT_EMAIL` 違い。
- **`Anthropic API 失敗 401`** → APIキー違い／残高不足。
- **署名検証NG（401）** → `LINE_CHANNEL_SECRET` 違い。
- **どの車か分かりませんでした** → 名前/車種の表記を変えて再送。実データに合わせて呼び方を揃えると精度が上がる。
- **通知が来ない** → `.env` の `NOTIFY_TARGET` が空／`node bin/notify.mjs --dry` で中身を確認。
