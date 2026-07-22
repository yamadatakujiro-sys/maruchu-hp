# 納品ランナー（runbook）— LINE AIオフィス 代行セットアップ手順書

このドキュメントは、**顧客1社ぶんの「LINE AIオフィス」を代行構築して引き渡す**ための、
再現可能なチェックリストです。上から順に実施し、各ステップの「✓ 完了条件」を満たしてから次へ進みます。

> 対象読者：構築担当（あなた）。顧客は非技術者である前提で、専門用語には一言補足を添える。

---

## 0. 用語と全体像（最初に頭に入れる）

- **オーナー**：顧客（このAIオフィスの持ち主）。LINEで指示を出す人。
- **リーダー**：司令塔のAI社員。オーナーの窓口になり、各担当へ仕事を振り分ける。
- **メンバー**：職種別のAI社員（lp / designer / writer など）。
- **司令室方式**：オーナーは**1つのLINEルーム**でリーダーとだけやり取りし、進捗・完了報告も
  すべてリーダーに集約される運用方式。
- **常駐3本**：`office-bridge`（LINE受信→起動）／`spawn-watcher`（task.md監視→起動）／`leader-poll`（受付係）。

全体の流れ：
```
オーナー（LINE）→ office-bridge → 担当AI即起動
                   ↘ leader-poll（受付係）→ 各担当の inbox/task.md に振分け
                                            ↘ spawn-watcher が task.md を検知して担当AI起動
   各担当の報告 → リーダーに【担当名】付きで集約 → オーナーの1ルームに届く
```

---

## 1. 事前準備（契約・アカウント）

顧客と合意のうえ、以下を準備する。**代行取得するか顧客名義で用意してもらうかを最初に決める。**

| 項目 | 用途 | 名義 | メモ |
|---|---|---|---|
| Claude（Pro/Max など） | AI社員の頭脳 | **顧客名義を推奨** | 利用量上限に注意（§FAQ） |
| LINE Developers アカウント | LINE連携 | 顧客名義 | Messaging API を使う |
| Cloudflare アカウント | Webhook受け口（トンネル/ワーカー） | 顧客名義 | ngrokは不要 |
| 常時起動できる Mac 1台 | 実行環境 | 顧客所有 | **専用 Mac mini を強く推奨**（§6） |

**✓ 完了条件**：上記4点のアカウント情報・Mac の実機が揃い、構築担当がアクセスできる。

---

## 2. 環境構築（Mac上）

1. **Node.js** をインストール（LTS版）。`node -v` で確認。
2. **Claude Code** をインストールし、`claude` コマンドが通ることを確認（`which claude`）。
   - ここで出たパスを後で `config/office.conf` の `CLAUDE_BIN` に設定する。
3. **line-harness** をデプロイ：`npx create-line-harness` を実行し、案内に従う。
   - MITライセンスの土台。`THIRD-PARTY-LICENSES.md` を必ず同梱したまま運用する。

**✓ 完了条件**：`node -v` と `which claude` が正しい値を返し、line-harness の雛形が生成されている。

---

## 3. LINE チャンネル作成 ＋ Webhook 設定

1. LINE Developers で、**メンバー数ぶんの Messaging API チャンネル**を作成する
   （リーダー＋各担当。v1の8職種なら8チャンネル）。
2. 各チャンネルの **チャネルアクセストークン** と **チャネルシークレット** を控える。
3. 各チャンネルの **Webhook URL** に、Cloudflare 経由の受け口URLを設定し、Webhookを有効化する。
4. 取得した値を line-harness の **`.env`** に記入する。

> つまずきポイント：チャンネルとメンバーの対応（どのトークンがどの担当か）を取り違えると、
> 「別の担当から返信が来る」事故になる。**対応表をスプレッドシートで管理**してから登録する。

**✓ 完了条件**：各チャンネルの友だち追加→テスト送信で、Webhookにイベントが届く。

---

## 4. MCP を user スコープで全メンバーに開放

- line-harness の MCP サーバ（既定名 `line-harness`）を、Claude Code の **user スコープ**で登録する。
  これで全メンバーのセッションから LINE 送受信ツールが使える。
- `config/office.conf` の `MCP_NAME` を、実際に登録したMCP名に合わせる。

**✓ 完了条件**：任意のメンバーディレクトリで Claude を起動し、MCPツール（会話取得・返信）が見える。

---

## 5. キット導入（install.sh 実行）

1. このキットを Mac の作業場所へ配置する（例：`~/ai-office-kit`）。
2. **`config/office.conf` を顧客向けに編集**する（ここが代行作業の中心）：
   - `OFFICE_HOME`：オフィス本体の置き場所（例：`~/ai-company`）
   - `CLAUDE_BIN`：§2で確認した `claude` のフルパス
   - `MEMBERS`：顧客の業種に合わせた社員構成。書式は `"<dir>:<表示名>:<role-template.md>"`
     （先頭は必ず `member-leader`）
   - `OWNER_FRIEND_ID` / `PORT` / `POLL_MS` / `MAX_CONCURRENT` / `THRESHOLD_MIN` / `MCP_NAME`
3. **`./install.sh` を実行**する。役割層＋共通層から各社員の `CLAUDE.md` が組み上がる。
   - 自己テスト（全社員の `CLAUDE.md` 生成チェック）が通ることを確認する。
4. 常駐3本（`office-bridge` / `spawn-watcher` / `leader-poll`）を **launchd で常駐**させ、
   Claude Code フック（SessionStart / CwdChanged）を `~/.claude/settings.json` に登録する。
   - ※この常駐・フック登録部分は実ソース提供後に install.sh へ実装（現状はTODOマーカー）。

> つまずきポイント：`MEMBERS` の先頭が leader でないと司令室方式が成立しない。
> 図書館に無い顧客独自職種は、ここで役割テンプレを1枚書き起こす（＝主要な課金ポイント）。

**✓ 完了条件**：`OFFICE_HOME/members/<各社員>/CLAUDE.md` が生成され、自己テストがパスする。

---

## 6. Mac 常時起動の設定（最重要・無反応事故の最大要因）

AIは顧客のMac上で動くため、**Macがスリープすると全社員が止まる**。納品時に必ず設定する。

1. **`office.conf` の `PREVENT_SLEEP="true"`（既定）** で `install.sh` 実行 → `caffeinate` が
   launchd 常駐（`com.lineaioffice.caffeinate`・`caffeinate -s -i`）で登録され、**Mac再起動後も
   スリープを自動抑止**する。確認：`pmset -g | grep sleep` に `sleep prevented by ... caffeinate`。
2. 併せてシステム設定 → ディスプレイ/バッテリー：電源接続時に**スリープしない**にしておくと確実
   （`pmset` 系の設定も可）。
3. 自動再起動・自動ログイン・常駐（launchd）を有効にし、**再起動後もオフィスが自動復帰する**ことを確認する。

> ⚠️ 実機事故（2026-07-18）：`caffeinate` が一時タイマー（`-t`付き）だけだと Mac が寝て
>   トンネル・bridge ごと止まり「翌朝 無反応」になった。**恒久常駐（keepalive・`-t`なし）が必須**。

> 強く推奨：顧客の作業用Macではなく、**据え置きの専用 Mac mini**（またはクラウドMac）を使う。
> 「常時起動問題」が運用トラブルの大半なので、上位プランとして提案する（§商品設計）。

**✓ 完了条件**：Macを再起動しても、常駐3本が自動で立ち上がり、LINEに反応する。

---

## 7. 受け入れテスト（end-to-end）

顧客の前で、実際のLINEから一連の流れを通す。

1. オーナーのLINEから、リーダー宛に依頼を1通送る。
2. リーダーが受け付け、担当の `inbox/task.md` に振り分ける。
3. 担当AIが**自動起動**して着手する（「ターミナルを開いて」等の操作案内は出ない）。
4. 担当の報告が `【担当名】` 付きでリーダーに集約され、**オーナーの1ルームに届く**。
5. （任意）`THRESHOLD_MIN` 超の放置で死活監視のSTALL警告が出ることを確認。

**✓ 完了条件**：LINE 1通 → 担当自動実行 → 1ルームに【担当名】報告、が再現する。

---

## 8. 引き渡し

- オーナー向けに「LINEでの依頼の出し方」「1ルーム集約の見方」を**説明会**で共有する。
- 緊急時の連絡先と、よくある不具合の一次対処（§FAQ）を渡す。
- 設定値（`office.conf`）とチャンネル対応表を、顧客と構築担当の双方で保管する。

**✓ 完了条件**：オーナーが自分でLINEから依頼を出し、報告を受け取れる状態。

---

## FAQ / つまずきポイント（今回の経験＝サポートの原資産）

| 症状 | 原因 | 一次対処 |
|---|---|---|
| LINEに反応しない | **Macがスリープ/再起動で停止** | Mac起動・スリープ設定確認・常駐3本の生存確認 |
| LINEに反応しない（トンネル/bridgeは生存） | **Claude Code のログイン(OAuth)切れ** | Macで `claude` を開き **`/login`** で再ログイン（§E）。authwatch/bridge が切れをLINE通知する |
| 途中で止まる/エラー頻発 | **Claude 利用量の上限** | プラン確認、上限到達時はリセットまで待機 or 上位プラン |
| 別の担当名で返信が来る | チャンネルとメンバーの対応ミス | `.env` とチャンネル対応表を突き合わせて修正 |
| 「ngrokは？」と聞かれる | 旧情報。本構成は Cloudflare 受け口 | ngrok不要と周知 |
| 報告がオーナーに直送される | 共通層ルールの未注入 | 各社員 `CLAUDE.md` に共通層が入っているか確認（install.sh再実行）|
| 担当の「着手の一報（了解しました）」が出ない | 担当が作業を先に始めて一報を省略 | 一報を「最初の必須ツール呼び出し」に強化済み（spawn-watcher/SESSION-MODE-TEMPLATE）。反映は install.sh 再実行 |
| **何もしてないのにトークンを激しく消費** | **pollモードの leader-poll が30秒ごとにClaude起動**（Mac再起動で復活し得る） | §C参照。**pushモードに固定**し leaderpoll のplistを削除する。`launchctl list \| grep leaderpoll` が空になればOK |

---

## 運用・復旧クイックガイド（実オペで得た手順）

### A. Mac再起動/スリープ後に「LINEで無反応」→ 受け口の立て直し
常駐（bridge等）は自動復帰が未実装のため、Mac再起動後は手動で立て直す。
1. 受け口の生存確認：`curl http://127.0.0.1:<PORT>/health`（既定PORTは office.conf。応答が無ければ停止）
2. 立て直し：キット直下で **`bash install.sh`**（launchd常駐を再登録＋自己テスト）
3. 最後に `✓ bridge /health 応答OK` が出れば復活。LINEに一言送って実応答を確認。
- ※`install.sh` は各社員の `CLAUDE.md` を雛形から**作り直す**。ゆえに社員ファイルを手編集したカスタムは消える → 恒久化したい変更は必ず `roles/` か `templates/SESSION-MODE-TEMPLATE.md`（雛形）側に入れること。

### B. 雛形だけを安全に更新（office.conf 等のローカル設定を壊さない）
リポジトリの特定ファイルだけを取り込みたい時（例：着手一報の強化を反映）：
```
git fetch origin <branch>
git checkout origin/<branch> -- ai-office-kit/bin/spawn-watcher.mjs ai-office-kit/templates/SESSION-MODE-TEMPLATE.md
cd ai-office-kit && bash install.sh
```
指定ファイルだけ更新され、`config/office.conf`（OFFICE_HOME/PORT/MODE等の顧客設定）は触らない。

### C. 動作モードは push 固定（poll禁止）＝トークン浪費クレームの予防
**納品時も自分用も、必ず `MODE="push"`。** poll は待機中も Claude を起動し続け、顧客の利用枠を枯らして「使えない」クレームになる。
- push固定にする：
  ```
  sed -i '' 's|^MODE=.*|MODE="push"|' config/office.conf
  bash install.sh   # push運用なら leader-poll は常駐登録されない（既存plistも削除される）
  ```
- **Mac再起動後の残存チェック**（leaderpollが復活してないか）：
  ```
  launchctl list | grep leaderpoll        # 何も出なければOK
  ```
- 万一 leaderpoll が残っていたら完全削除（再起動でも復活しない）：
  ```
  launchctl unload ~/Library/LaunchAgents/com.lineaioffice.leaderpoll.plist 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.lineaioffice.leaderpoll.plist
  pkill -f "claude -p" 2>/dev/null
  ```
- 番人（bridge/watcher）は起動したままでOK（Node製・待機中トークンゼロ）。完全停止したい時のみ各plistをunload。

### D. LINEに送っても無反応（bridgeは生きてるのに届かない）＝トンネル切れ ★重要
- 構成：LINE → **Cloudflare Worker(line-harness)** → **トンネル(ngrok もしくは cloudflared)** → Macのbridge。**Mac再起動でトンネルが落ちると、着信がbridgeに届かず全て無反応**になる（push運用は着信起動なので、これが起きると沈黙する）。恒久対策は本項末尾（launchd自動復帰）を参照。
- 切り分け：`ps aux | grep -Ei "ngrok|cloudflared|wrangler" | grep -v grep`（何も出なければトンネル停止）／bridgeは `curl http://127.0.0.1:<PORT>/health` が `ok` なら生きている（PORTは office.conf。過去に18789→18790へ変わっていた事例あり）。
- **当面の回避策（トンネル無しで手動起動）**：オーナーがLINEで依頼を送った後、下記でリーダーを1回手動起動すると、リーダーがLINEを直接読んで担当に振り分ける（送受信はWorker API経由なのでトンネル不要）：
  ```
  cd ~/line-ai-office-test/members/member-leader && /opt/homebrew/bin/claude -p 'LINEの未返信メッセージを確認し、依頼があれば担当のinbox/task.mdに振り分け、オーナーのLINEに一言返信して。friendIdはリーダーの会話履歴から確認' --permission-mode bypassPermissions
  ```
  ⚠️ `claude -p '...'` は**必ずシングルクォート**で囲む（`!`等が含まれるとzshが `event not found` で壊す）。
- **恒久対策（実装済み・実機で動作確認 2026-07-17）**：トンネルを launchd で自動復帰させる。
  トンネル実体は **ngrok の無料固定ドメイン**を推奨（cloudflared と違い**独自ドメイン不要**）。
  - **確定した動作経路**（この形で実機の自動起動を確認済み）：
    ```
    LINEメッセージ
      → line-harness Worker (…workers.dev/webhook)         ← LINE Developers の Webhook URL。変更不要
      → line-harness Outgoing Webhook（message_received を転送・要登録）
      → ngrok 固定URL  https://<xxxxx>.ngrok-free.dev/webhook   ← launchd keepalive で常駐
      → Mac bridge (127.0.0.1:18789/webhook)
      → 該当社員を spawn
    ```
    ※LINE Developers 側の Webhook URL は Worker のまま**触らない**。トンネルの差し替えは Worker の
      Outgoing Webhook 転送先＝ngrok固定URLで行う。
  - 手順（ngrok・推奨）：
    1. `ngrok.com` 登録（メール＋パスワード推奨。OAuthはループしやすい）→ **Domains** で固定ドメイン発行 →
       **Your Authtoken** をコピー。
    2. Mac で `brew install ngrok` → `ngrok config add-authtoken <token>`。
    3. `config/office.conf` の **`TUNNEL_CMD`** に設定：`TUNNEL_CMD="ngrok http --domain=<xxxxx>.ngrok-free.dev 18789"`。
    4. `bash install.sh` → `com.lineaioffice.tunnel` が **keepalive + RunAtLoad** で常駐登録される。
    5. line-harness Worker の Outgoing Webhook 転送先を `https://<xxxxx>.ngrok-free.dev/webhook` に設定
       （payload に `lineAccountId`＝送信元チャネルのUUIDを含めること。bridge がこれで担当を解決する）。
  - 別解（Cloudflareに独自ドメインを持っている場合）：`TUNNEL_CMD="cloudflared tunnel run my-office"`。
  - 検証：`launchctl list | grep com.lineaioffice.tunnel` に出る／`pkill -f ngrok`（cloudflaredなら `pkill -f cloudflared`）後に
    数秒で自動復活し**固定URLは不変**／Mac再起動後もLINE 1通で担当AIが自動起動。あわせて§6のスリープ無効も必須。
  - ログ：`$OFFICE_HOME/logs/tunnel.log` / `tunnel.err.log`。死活監視：`watchdog.sh` が
    トンネル停止時に `⚠ TUNNEL DOWN` を出す（`TUNNEL_CMD` の先頭語からプロセスを自動判定）。
  - `TUNNEL_CMD` 未設定のまま `install.sh` を実行すると警告が出る（トンネル常駐なし＝従来の手動運用）。
- **Worker のビルド漏れ注意（実機ハマり・2026-07-18）**：line-harness Worker（`event-bus.ts` 等）を
  直したら、**`wrangler deploy` 単独では TypeScript が未コンパイル**で反映されないことがある。
  必ず **`vite build && wrangler deploy`**（＝正式ビルド）で出す。未ビルドだと outgoing webhook の
  `lineAccountId` が空になり、bridge が `UUID=undefined` で**全メッセージを黙って無視**する。
- **成果物画像のLINE自動表示**：imgbb等の外部登録は不要。line-harness の R2 (`POST /api/images`) に
  画像をアップ→公開URL→LINE画像メッセージで送る。デザイナー等の完成報告に組み込むと、
  **成果物が"画像そのもの"としてトークに並ぶ**（顧客がファイル場所を知らなくても見える＝商品価値）。

### E. Claudeログイン切れ（認証失効）で全社員が沈黙 ★重要（2026-07-22 実機発生）
- **症状**：トンネルもbridgeも生きているのに、LINEを送っても無反応。spawn ログ（`logs/spawn-<member>.log`）に
  `Please run /login` / `401 OAuth access token has expired. Re-authenticate to continue.` が出る。
- **原因**：Claude Code のログイン(OAuthトークン)が失効。push型は着信で `claude` を spawn するが、
  認証切れだと spawn した claude が **401 で即死**し、AI社員は何も返せない。しかも Claude 自身が認証切れなので
  「ログイン切れ」とすら言えず**完全な沈黙**になる（トンネル対策では絶対に防げない別系統の弱点）。
- **一次対処（30秒）**：Macで対象オフィスの Claude Code を開き、**`/login`** → `1. Claude account with subscription`
  → ブラウザで承認。完了後、リーダーに一言送れば復旧。急ぎは手動キック（§Dの `claude -p '...'`）。
- **恒久対策（キット実装済み・2026-07-22）**：Claude認証に依存しない Node/bash 層で検知＆LINE通知する：
  - `bin/line-notify.mjs`：line-harness API 直叩きのテキスト送信部品（**認証切れでも飛ぶ**通知路）。
  - `office-bridge.mjs`：spawn ログの401を検知→**①送信者へ「少々お待ちください」自動返信（顧客を沈黙させない）
    ②オーナーへ「/loginして」を通知**（10分に1回まで）。
  - `bin/authwatch.sh`：既定6時間おきに最小プロンプトで認証を点検→切れていれば**先回りでオーナーに通知**
    （`office.conf` の `AUTH_WATCH="true"`。切りたい時のみ false）。
  - `bin/watchdog.sh`：トンネル停止・bridge停止も検知して**オーナーのLINEに通知**（15分おき常駐・連投抑制）。
  - いずれも通知先は `OWNER_FRIEND_ID`。反映は `bash install.sh` 再実行（`com.lineaioffice.watchdog` /
    `com.lineaioffice.authwatch` が登録される）。→ **「沈黙して顧客が離脱」を構造的に予防**できる。

---

## 検証（再現性の最終確認）

まっさらなテスト環境（テスト用 LINE / Cloudflare / 別ユーザー）で、この runbook 通りに
`install.sh` 主導で一気通貫構築し、以下を確認できれば「他人が同じ手順で再現できる商品」として成立：

- 常駐3本が launchd 常駐（`launchctl list | grep com.lineaioffice`）
- ブリッジ生存（`curl http://127.0.0.1:<PORT>/health` が `ok`）
- `~/.claude/settings.json` に SessionStart / CwdChanged フックが登録され、メンバーdirで発火
- LINE 1通 →（push型）担当AI即起動 ＋ リーダー振分け → 1ルームに【担当名】報告
- Mac スリープ無効が効いている
