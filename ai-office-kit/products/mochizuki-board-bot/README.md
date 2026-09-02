# 工程ボードBot（望月オート案件）

**ホワイトボード → スマホ共有 → AI** を本番構成で動かす独立プロダクト。
LINEに現場の一言を打つ／喋ると、Claudeが意味を判断してGoogleスプレッドシートの工程ボードを自動更新。
納期の重なり・遅れ・本日納車は「先回り通知」でLINEに届く。

- 案件スレッド：`ai-office-kit/docs/CASE-mochizuki-whiteboard.md`
- 体験デモ（設定不要）：`ai-office-kit/assets/whiteboard-demo/board-demo.html`
- この本番Botの立ち上げ手順：**[SETUP.md](./SETUP.md)** ← まずこれ

## 仕組み（全体像）

```
  社員のLINE（いつものLINE、新アプリ不要）
        │  「田中さんのハイエース 塗装終わった」
        ▼
  LINE Messaging API ──(Webhook)──▶ このBot（Node・Mac or クラウド）
                                        │ 1. 署名検証
                                        │ 2. Claude(Haiku)が意味を解釈
                                        │    → どの車を・どの工程へ
                                        │ 3. Googleスプレッドシートを更新
                                        ▼
                              Googleスプレッドシート（＝みんなの工程ボード）
                                        │  全員のスマホで即共有
        ┌───────────────────────────────┘
        ▼
  先回り通知（cron）: 納期被り・遅れ・本日納車 → LINEへpush
```

## 設計方針
- **依存ゼロ**：Node標準ライブラリ（`node:http` / `node:crypto` / `fetch`）だけ。`npm install` 不要。
- **AIは判断だけ／更新はコード**：Claudeには「どの車をどの工程へ」を判断させ、シート書き換えはコードが確定的に行う（暴走・誤更新を防ぐ）。
- **相手名義で売り切り**：LINE公式・Google・Anthropic APIキーはクライアント名義で発行できる。土台を渡せば月次コストはクライアント持ち。
- **盛らない**：1メッセージ＝1台。写真見積・保険連携などは扱わない（案件方針どおり）。

## ファイル構成
```
mochizuki-board-bot/
├─ SETUP.md              立ち上げ手順（Mac＋cloudflared・オーナー名義前提）★まずこれ
├─ README.md             このファイル
├─ .env.example          必要な鍵の一覧（.env にコピーして埋める）
├─ config/board.config.json  工程名・シート列・通知ルール（訪問後はここを直すだけ）
├─ src/
│  ├─ server.mjs         Webhookサーバー（本体）
│  ├─ handler.mjs        受信→解釈→更新→返信の中核
│  ├─ claude.mjs         Claudeで意味を解釈
│  ├─ sheets.mjs         Google Sheets 読み書き（サービスアカウント）
│  ├─ board.mjs          ボードのモデル（車の一覧・移動・追加）
│  ├─ line.mjs           LINE署名検証・返信・push
│  ├─ notify.mjs         先回り通知のロジック
│  └─ config.mjs         設定ロード
├─ bin/notify.mjs        先回り通知の実行（cron/launchdから）
└─ scripts/
   ├─ init-sheet.mjs     シートにヘッダ＋サンプルを投入
   └─ selftest.mjs       クレデンシャル不要の自己テスト（npm run check）
```

## よく使うコマンド
```bash
node scripts/selftest.mjs         # ロジックの自己テスト（鍵不要）
node scripts/init-sheet.mjs --sample   # シート初期化＋サンプル投入
node src/server.mjs               # Botサーバー起動
node bin/notify.mjs --dry         # 先回り通知の中身を送信せず確認
node bin/notify.mjs               # 先回り通知を実送信（差分があれば）
```

## コスト感（案件ファイルより）
- Googleスプレッドシート：無料
- LINE公式：無料〜ライト（望月オート規模なら十分）
- Anthropic API：Haiku 4.5 従量＝月500〜1,000円目安
- サーバー：Mac常駐（テスト）〜 クラウド無料枠〜数百円/月
- → **フルでも1社あたり月1万円いかない見込み。**
