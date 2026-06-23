# LINE AIオフィス キット

**LINEだけで動く“あなた専用のAIチーム”** を、顧客ごとに構築して納品するための代行セットアップ用キットです。
設定ファイル `config/office.conf` を書き換えて `./install.sh` を実行するだけで、リーダー＋各担当のAI社員が
組み上がり、LINE連携・自動起動まで一式セットアップされます。

> ベース技術：Claude Code（マルチエージェント）× LINE連携（line-harness, MIT）。
> 詳細は `THIRD-PARTY-LICENSES`（同梱予定）と各ドキュメントを参照してください。

---

## これは何をするもの？

オーナー（顧客）は **LINEでリーダーAIに話しかけるだけ**。リーダーが内容を理解して担当AIに振り分け、
できあがった成果物を**同じLINEのトークに報告**します（司令室方式）。

```
オーナー（LINE）→ office-bridge → 担当AIを即起動（push型）
                   ↘ leader-poll（受付係）→ 各担当の inbox/task.md に振り分け
                                            ↘ spawn-watcher が task.md を検知して担当AIを起動（poll型）
   各担当の報告 → リーダーに【担当名】付きで集約 → オーナーの1ルームに届く
```

---

## フォルダ構成

```
ai-office-kit/
├── install.sh                     # インストーラ（これを実行する）
├── config/
│   └── office.conf                # 顧客ごとに書き換える設定（ここだけ編集すればOK）
├── templates/
│   └── SESSION-MODE-TEMPLATE.md   # 全社員共通の動作ルール（共通層）
├── roles/                         # 職種別の役割テンプレ図書館（役割層）
│   ├── leader.md / lp.md / designer.md / writer.md
│   ├── video.md / sns.md / researcher.md / analyst.md
│   └── README.md
├── bin/                           # 常駐部品・フック（すべて office.conf 駆動）
│   ├── office-bridge.mjs          # LINE push受信 → 担当AIを即起動
│   ├── spawn-watcher.mjs          # inbox/task.md 監視 → 担当AIを起動
│   ├── leader-poll.sh             # 受付係（リーダーがLINEを確認して振り分け）
│   ├── watchdog.sh                # 死活監視（タスク滞留の警告）
│   ├── session-start-hook.sh      # 起動ルーチン注入（SessionStart）
│   ├── cwd-changed-hook.sh        # 起動ルーチン注入（CwdChanged）
│   └── inject-session-mode.sh     # 共通層を全社員へ一括注入（再注入用）
└── docs/
    ├── RUNBOOK.md                 # 代行セットアップの手順書（納品チェックリスト）
    ├── PRODUCT-SUPPORT.md         # 商品・サポート・価格設計
    └── SALES-ONEPAGER.md          # 営業用1枚（SNS/ココナラ素材つき）
```

**社員は2層で構成**されます：
- **役割層**（`roles/<職種>.md`）… 社員ごとに違う「仕事のしかた」
- **共通層**（`templates/SESSION-MODE-TEMPLATE.md`）… 全社員共通の動き方・報告ルール・誠実さルール

`install.sh` が「役割層 → 共通層」の順で各社員の `CLAUDE.md` を組み立てます。

---

## 動作要件

- 常時起動できる **Mac**（スリープすると停止するため。専用機を推奨）
- **Node.js**（`node`）
- **Claude Code**（`claude`）
- **jq**（マニフェスト生成・フック登録に使用）
- **line-harness**（LINE連携。MITライセンス）と各LINEチャンネルの設定

---

## クイックスタート

```bash
# 1. 設定を自分の環境に合わせて編集
#    最低限： OFFICE_HOME（オフィスの置き場所）と CLAUDE_BIN（which claude のパス）
#    社員構成は MEMBERS 配列で増減・差し替え（先頭は必ず member-leader）
vi config/office.conf

# 2. インストール（社員組み立て → 部品配置 → launchd常駐 → フック登録 → 自己テスト）
./install.sh

# 3. 確認
launchctl list | grep com.lineaioffice          # bridge / watcher / leaderpoll の3本
curl -s http://127.0.0.1:18789/health           # {"status":"ok", ...} が返る
```

詳しい納品手順（LINEチャンネル作成・Webhook・Mac常時起動・受け入れテスト）は
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) を参照してください。

---

## 設定ファイル（config/office.conf）の要点

| キー | 意味 |
|---|---|
| `OFFICE_HOME` | オフィス本体の基準パス（社員・inbox・logs がここにできる） |
| `CLAUDE_BIN` | `claude` 実行ファイルのパス（`which claude` で確認） |
| `PORT` | office-bridge の待受ポート（既定 18789） |
| `POLL_MS` / `MAX_CONCURRENT` | 見張り役のポーリング間隔・同時起動上限 |
| `THRESHOLD_MIN` | 死活監視のタスク滞留しきい値（分） |
| `OWNER_FRIEND_ID` / `MCP_NAME` | オーナーの friendId / LINE連携MCPのサーバ名 |
| `MEMBERS` | 社員定義の配列。書式 `"<dir>:<表示名>:<role-template.md>"`（先頭は leader） |

**社員の入れ替え＝`MEMBERS` を書き換えるだけ**。業種に合わせて自由に構成できます。
`roles/` に無い独自職種は、テンプレを1枚追加すれば組み込めます。

---

## アンインストール／お試し後の後片付け

```bash
# 常駐を停止・削除
launchctl unload ~/Library/LaunchAgents/com.lineaioffice.bridge.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.lineaioffice.watcher.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.lineaioffice.leaderpoll.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.lineaioffice.*.plist
# オフィス本体を削除（必要なら）
rm -rf "<OFFICE_HOME>"
```

`~/.claude/settings.json` に登録したフックは、不要なら該当 OFFICE_HOME のパスを含むエントリを取り除いてください。

---

## ドキュメント

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) … 代行セットアップの手順書（納品チェックリスト・FAQ）
- [`docs/PRODUCT-SUPPORT.md`](docs/PRODUCT-SUPPORT.md) … 提供範囲・サポート・価格設計
- [`docs/SALES-ONEPAGER.md`](docs/SALES-ONEPAGER.md) … 営業用1枚（SNS/ココナラ素材）
- [`roles/README.md`](roles/README.md) … 役割テンプレ図書館の説明

---

## ライセンス・法務メモ

- ベースの line-harness は MIT ライセンス。再配布時は原ライセンス表記を保持すること。
- Claude / LINE / Cloudflare の各利用規約への顧客同意が前提です。
- 金銭が発生する提供では、契約・ライセンスについて専門家への相談を推奨します（本書は法的助言ではありません）。
