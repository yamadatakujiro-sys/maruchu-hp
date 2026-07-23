# プロジェクト現況・決定事項ログ（PROJECT-STATUS）

> このファイルは「ここまでの内容を忘れないため」の記憶。次に作業を再開する人（AI含む）が
> これを読めば全体像と決定事項を把握できる。**新しい決定をしたらここに追記すること。**
> 最終更新の目安：2026-06 時点。

---

## 1. これは何のプロジェクトか
- 商品名 **「LINE AIオフィス」**。Claude Code のマルチエージェント（リーダー＋職種別AI社員）× LINE連携を、
  顧客ごとに**代行セットアップして納品**するサービス。顧客はLINEでリーダーに話しかけるだけ。
- 土台は line-harness（MITライセンス・商用OK／表記保持が条件）。オリジナルにリブランド済み。
- リポジトリ：`yamadatakujiro-sys/maruchu-hp` の `ai-office-kit/` 配下。作業ブランチ `claude/relaxed-wright-7dlibu` → main へPRマージ運用。

## 2. 完成しているもの（すべて main 反映済み・実機検証済み）
- `install.sh`：office.conf を読み、社員を組み立て→部品配置→launchd常駐→フック登録→自己テスト。**実機(Mac)で完走確認済み**。
- `config/office.conf`：顧客ごとに書き換える設定。`MEMBERS` 配列で社員を増減。
- `templates/SESSION-MODE-TEMPLATE.md`：全社員共通層（起動の2系統／司令室報告／着手の一報／誠実さルール）。
- `roles/`：職種別テンプレ（8職種：leader/lp/designer/writer/video/sns/researcher/analyst ＋ README）。
- `bin/`：7部品（すべて office.conf 駆動）
  - office-bridge.mjs（LINE push受信→起動）/ spawn-watcher.mjs（task.md監視→起動）/ leader-poll.sh（受付係）
  - watchdog.sh（死活監視）/ session-start-hook.sh・cwd-changed-hook.sh（フック）/ inject-session-mode.sh（共通層注入）
- `docs/`：RUNBOOK（納品手順）/ PRODUCT-SUPPORT（商品・サポート設計）/ SALES-ONEPAGER（営業1枚＋SNS素材）/
  COCONALA-LISTING（ココナラ出品テンプレ）/ X-LAUNCH-30DAYS（X運用30日プラン）/ 本ファイル。

## 2b. 原システムからの再構築の記録（Part1・最初にやった核心）
- **元システム**：オーナーのMac `~/ai-company`（addnessの講座由来のAI社員システム）。**原本はオーナーのMac上に現存**＝消えない。本キットはそれをオリジナルに作り替えたもの。
- **7部品の旧→新マッピング**（中身は各 `bin/` ファイル冒頭コメントにも記載）：
  - `line-bridge/server.mjs` → `bin/office-bridge.mjs`（LINE push受信→spawn）
  - `scripts/auto-spawn-watcher.mjs` → `bin/spawn-watcher.mjs`（task.md監視→spawn）
  - `scripts/leader-poll.sh` → `bin/leader-poll.sh`（受付係）
  - `scripts/watchdog.sh` → `bin/watchdog.sh`（死活監視）
  - `scripts/session-start-hook.sh` → `bin/session-start-hook.sh`（フック）
  - `scripts/cwd-changed-hook.sh` → `bin/cwd-changed-hook.sh`（フック）
  - `scripts/inject-session-mode.sh` → `bin/inject-session-mode.sh`（共通層注入）
- **パラメータ化**：ハードコード値を `config/office.conf` に外出し（`~/ai-company`→OFFICE_HOME／`/opt/homebrew/bin/claude`→CLAUDE_BIN／ポート18789→PORT／メンバー英名→MEMBERS／friendId→OWNER_FRIEND_ID／MCP名line-harness→MCP_NAME／POLL_MS・MAX_CONCURRENT・THRESHOLD_MIN）。社員はフォルダ自動判定＋office-members.jsonで管理。
- **役割の仕分け**：元10メンバー→**v1は8職種採用**（leader/lp/designer/writer/video/sns/researcher/analyst）。**product＝自社テンプレ依存で当面除外／brunson＝市販書籍複製で著作権リスクのため除外**。
- **リブランド**：「AI企業」→「LINE AIオフィス」。コメント/ログ/プロンプトの文言を自社のものに統一。文言「経営者」→「オーナー」。line-harness(MIT)の表記は同梱方針。
- ＝**「AI社員を作った部分」は会話ではなく `bin/`(7部品)＋`roles/`(8職種)＋`install.sh`＋`config`＋`templates` として main に永続**。実機(Mac)で組み立て・常駐・health確認まで成功済み。

## 3. 確定した決定事項
- **v1出荷=8職種**：leader / lp / designer / writer / video / sns / researcher / analyst。
  - product（自社テンプレ依存）は当面除外。brunson（市販書籍複製で著作権リスク）は商品から除外。
- **動作モードは push 固定・poll 禁止で確定（2026-07-08）**。自分用も出荷商品も必ず `MODE="push"`。LINE着信時"だけ"動く＝待機トークン消費ゼロ。
  - 理由：pollは受付係(leader-poll)が30秒ごとにClaudeを起動し続け、**顧客の利用枠を枯らして「トークン切れで使えない」クレームの直接原因**になる。実機で発生→leaderpollのplist削除で根絶済み。
  - 番人 bridge/watcher はNode製で待機中トークン=0（起動したままでOK）。Claude(課金)はLINE着信時のみ起動。
  - Mac再起動でleaderpollが復活し得るため、`launchctl list | grep leaderpoll` が空か確認する運用（手順は`RUNBOOK.md` §C）。
- **【最新決定】販売モデルは B（あなたが管理する1台に集約・運用代行）＋(あ)（顧客名義のClaude契約）に変更（2026-06-28）。**
  - 当初Aを選んだが、「他人のMacに非技術者が毎回構築」は事故リスクが高いと判明（オーナー自身も非技術者）。
  - B＝Mac mini等の常時起動1台に顧客ごとの“個室”を作る。顧客はLINEで使うだけ＝売りやすい・月額収益。
  - (あ)＝個室ごとに**顧客自身のClaude契約**でログイン＝容量(利用枠)とコストを顧客側に切り分け。
  - 詳細手順は `docs/DELIVERY-MODEL-B.md`。
  - 必要：あなた＝Mac/ネット/Cloudflare土管/キット。顧客＝Claude契約・LINE公式アカウント。
  - ココナラ提供形式は「サービス→ビデオチャット」（画面共有でオンボーディング）。
  - 未確定：顧客Claudeログイン運用の規約整理（専門家確認）／macOSユーザー分けの手順化／月額の具体額／将来の(い)API方式への移行。
  - （旧）Aは「顧客が自社運用したい」場合の別プランとして温存可。
  - **当面のサーバー機**：Mac mini はすぐ用意できないため、**1人目は現在のMacBookで開始**（電源つけっぱ・スリープ無効）。増えたら/落ち着いたら Mac mini へ移行。
  - **複数顧客の分け方**：手順は `docs/MULTI-TENANT-SETUP.md`。1人目はシンプル構築でOK／2人目同時はmacOSユーザー分け＋PORT分け／規模拡大時はAPI方式(い)へ改修。
  - **法務確認**：`docs/LEGAL-QUESTIONS.md` の論点を弁護士に相談予定。
  - **月額＝¥9,800で確定（最初から・割引なし）**。5件で月5万、10件で月約10万のストック＋初期費¥39,800/件。Claude代は顧客直払いのため月額はほぼ利益。実績後に¥19,800へ値上げ余地。
  - 目標：まず月5万（月額¥9,800×5件）→ ゆくゆく件数×単価×台数で拡大。サポートは1件あたり月1〜2時間（オーナーは1日2〜3時間可）＝時間はボトルネックでない。上限はMac/件数キャパ（5〜10件/台、超過は2台目orAPI化）。
  - ⚠️ ココナラ出品文(COCONALA-LISTING-FINAL)はモデルA前提で記述→**モデルB用に要書き直し**（顧客はMac不要／月額¥9,800は運用代行費として必須／顧客はClaude契約＋LINE公式を用意）。
- **価格**：方針は「まず実績作り→段階的に値上げ」。**フェーズ1（実績作り）の初期構築費＝¥39,800 で確定（2026-06-28）**。
  - **月額＝¥9,800 で確定（最初から。実績作り期も割引しない）**（2026-06-29）。モデルBでは月額は“運用代行(家賃)”＝必須。社員1名追加 +¥9,800〜。
  - フェーズ2（レビュー10件・★4.8以上で移行）：松竹梅 ¥98,000／¥150,000／¥250,000（たたき台）。
  - ¥39,800 は「実績作りの赤字覚悟」価格。これより下げない／早めに値上げ。最初の1〜2件のみ「創業モニター」で更に安くするのはアリ。
  - 市場相場（2026調査）：個人のLINE/AI導入支援は初期10〜30万、生成AI型チャットボット20〜50万。直接競合は無く、アンカリング（人を雇う月20-30万／外注1案件3-10万との比較）で割安に見せる。
- **差別化（addness対抗）＝社員の“数・種類”では戦わない**。標準は **8職種で固定**（2026-06-28決定）。
  - addnessはAI社員の品揃えを拡大中。数で追うと負け筋のため、堀は別に置く：①代行で“やってあげる”伴走 ②非技術者の個人事業主/中小ターゲット ③LINE完結UX＋push省トークン＋サポート。
  - 「固定」＝中身も磨き続ける。深さ・仕上がり・サービスで勝つ。
  - 顧客ごとの**カスタム職種追加（有料オプション）は継続**（＝主要課金ポイント）。テンプレは addness文章をコピーせず**オリジナルで同等品質**を作る。
- **販路・集客**：ココナラ＝受注/決済、**X（旧Twitter）＝集客の主軸**、顔出しショート動画で実演、note/ブログ=信頼。
  販売者は顔出し動画OK。X-LAUNCH-30DAYS.md に初動プランあり。

## 3b. 差別化方針 vs addness（2026-06-28・最重要）
- **addnessは「土台一式」を無料プレゼントとして配布している**（ウェビナー集客の撒き餌）。
  → **「仕組み・システムそのもの」では売れない／差別化できない**。売るのは **「代わりにやる労力・安心・カスタマイズ・サポート」**。
  → ¥39,800 は“ソフト代”ではなく **“構築の手間とサポート代”**。この線引きを全発信で貫く。
- **客層が違う＝別レーン（競合しない）**：
  - addness＝「自分でAI社員を作って稼ぎたい人」（DIY・教育・情報商材ファネル）。
  - 自分＝「作れない/作りたくない、本業が忙しい事業者」（代行・受託サービス）。
  - addnessが「AI社員」を広めるほど「代わりに作って」の需要が増える＝**追い風**。
- **マネしないこと（やると逆効果・法的リスク）**：
  - 収益訴求（「月100万」「初月◯◯万」等）→ **景品表示法・誇大広告リスク**。成果保証もしない。
  - 情報商材風のギラギラ煽り・ウェビナー→講座ファネル → 受託サービスでは信頼を下げる。
  - 「addness」の名前は出さない・比較しない。自分のレーンで淡々と。
- **勝ち筋**：顔出し＋実演（LINEで実際に動く）＋お客様の声＝**信頼で受注**。デザインは清潔・誠実に。
  - キャッチ例：「AIで“稼ぐ”じゃなく、AIに“働かせる”」「教えません。代わりに作って納品します」。

## 3c. ココナラの納品形態・カテゴリ（2026-06-28）
- **純粋な「データ納品」ではない＝セットアップ代行サービス**。納品物は“顧客のMac上に構築されたAIオフィス”。
  - 設定ファイル/手順書はデータで渡せるが、価値は「やってあげる」こと。
  - 非技術者が相手なので、**ビデオ通話で画面共有しながら一緒に構築（伴走）／または遠隔操作**が現実的。
    → ココナラ出品時は **ビデオチャット対応をONにしておく**とセットアップ伴走がしやすい（カテゴリにより可否が違うので出品画面で確認）。
  - ⚠️ 未確定：実際の「顧客Macへの構築手段」（画面共有伴走 or 遠隔操作ツール or 出張）を1つに決めて手順化する必要あり。
- **カテゴリ候補（出品画面で最も近いものを選ぶ）**：
  - 第一候補：「生成AI活用・開発・制作」系（AI導入・構築代行）
  - 代替：「業務効率化・自動化の相談・代行」／「AIチャットボット制作」
  - ※ ココナラのカテゴリ構成は変わるため、出品時に「AI」「業務効率化」「自動化」で検索して最適なサブカテゴリを選ぶ。
  - タグ例：AI / 業務効率化 / LINE / 自動化 / 個人事業主 / 中小企業。

## 3d. SNS/LINE集客の進捗・方針（2026-06-30）
- **X（主軸）**：アカウント `@line_ai_office`（表示名 タツ｜LINEで動くAIチームを作る人）開設済。プロフィール・ヘッダー(RPG風Canva自作)・固定ツイート・初投稿まで完了。発信方針はC案（物語・繋がり）。「稼ぐ系/情報商材化はしない」。
- **公式LINE（集客の受け皿）**：`AIオフィス｜LINEで動くAIチーム`(@453blnmx) 作成済。AI社員のbotやLucent(車部品)とは別の新規アカウント。
- **ファネル**：X（集客）→ 公式LINE（リスト化・教育・販売）→ 無料相談 → Stripe決済。決済はStripe（特商法表記・PP要・LEGAL-QUESTIONSに含む）。
- **LINEステップ配信シナリオ**：`docs/LINE-STEP-SCENARIO.md` に設計の考え方＋配信文（あいさつ＋5通・感想収集型／時刻指定19:00／1メッセージ1CTA／キーワード応答）を保存。テキスト版で稼働、リッチメッセージ画像・デモ動画は後で差し替え。
- ★**集客・導線設計の永続方針**：`docs/LINE-MARKETING-PRINCIPLES.md`（2026-06-30 オーナー指示「今後も全てこれでいきたい」）。
  あいさつ→ステップ配信→応答メッセージ→リッチメニュー→通しテストの原則を採用。**ただし収益断定コピー・学習元URL/コンテンツは流用せず、感想→無料相談→自社Stripeに置換**。今後のLINE/集客作業は必ずこれに従う。
- **Instagram＋Threads（2026-07-10 着手）**：事業ブランドで統一・新規開設する方針に決定（Xと世界観をそろえる）。設計・開設手順・bio・運用の役割分担は `docs/INSTAGRAM-THREADS-SETUP.md` に保存。ハンドル第1候補 `line_ai_office`（Xと統一）、公式LINE友だち追加URL `lin.ee/qhDuvmn` をプロフリンクに。**ThreadsはInstagram必須・ハンドル共通**のため「①インスタ→②スレッズ」の順。開設作業はオーナー実施（ログイン・認証は本人のみ）。デモ動画リール＋AI社員紹介を初回投稿に使う（文面は `DEMO-VIDEO.md`）。
- Mac mini未導入のため1人目は現MacBookで運用。

## 4. 運用・コストの重要メモ（トークン消費）
- bridge（受信待ち）と watcher（task.md監視）は**待機中ほぼ消費なし**。
- **leader-poll（定期起動）と5分Cron監視が主な消費源**。push運用ならこれらを使わず消費を抑えられる。
- 顧客のClaude利用枠を消費するため、月額やプラン設計に「想定利用枠」を必ず織り込む。
- 2026-06-28：オーナー本番の `~/ai-company` が `com.ai-company.leaderpoll`/`autospawn` で稼働し続け
  5時間枠を消費していたため停止（plistを `~/Desktop/ai-company-停止中plist/` に退避）。戻す時はplistを
  `~/Library/LaunchAgents/` に戻して `launchctl load`。

## 5. 実機検証で直した不具合（同じ轍を踏まないため）
- macOS の bash 3.2 ＋ `set -u` が配列要素・パターン展開を誤って unbound 判定 → install.sh は **nounset(-u) を外した**。
- `read <<<`（ヒアストリング）依存を全廃しパラメータ展開に。ログの全角括弧で文字化け→ASCII化。
- stat は Linux優先（`-c`）→ mac（`-f`）の順でクロスプラットフォーム化。

## 6. 機能の最新追加
- **着手の一報**：仕事を振られた担当が、作業前にまずリーダーのルームへ
  `【担当名】了解しました。着手します。` と一報を送る（spawn-watcher の起動プロンプト＋共通層に実装）。

## 7. 次にやる候補（2026-06-30 更新）
完了済み：価格確定／ココナラB版出品文／X開設・プロフ・固定・初投稿／公式LINE作成／LINEステップ配信シナリオ作成。
✅**公式LINE設定 完了（2026-07-01・テスト済み）**：あいさつ（自己紹介＋RPGリッチメッセージ画像／タップで「デモ」送信）／ステップ配信5通（登録N日後19:00・感想収集型・明日以降配信）／応答メッセージ4件（デモ・あとで・感想・相談／LINE仕様上キーワードは**完全一致**）／顔写真入りリッチメニュー（A=相談・B=デモ・C=サービス・D=Xリンクへ https://x.com/line_ai_office ）。
  - 応答＝**チャットON＋応答時間を「全部グレー（応答時間外）」に**して**24時間自動返信（bot）**が動く状態。相談が来たら手動チャットで対応。
  - リッチメニュー画像は当環境でHTML→PNG生成（1200×810／顔写真合成）。設計原則は `docs/LINE-MARKETING-PRINCIPLES.md`。
✅**X集客ファネル開通（2026-07-01）**：Xプロフィールの「ウェブサイト」に友だち追加URL(lin.ee/qhDuvmn)、bioに「無料相談＆実演デモはこちら👇」、LINE友だち追加カード付きの固定ツイートを設置。X→LINE→相談→成約の導線が全部つながった。
✅**デモ用 product bot 復旧＋実演成功（2026-07-02）**：Mac再起動で常駐が停止→`bash install.sh`で受け口(bridge)復活。リーダーへ「美容室のインスタ投稿文3本」依頼→SNS担当が自動着手→3本完成しオーナールームに集約、を実機確認（デモ素材化できるレベル）。運用復旧手順は`RUNBOOK.md`に保存。
✅**「着手の一報」強化（2026-07-02）**：担当が作業を先に始めて着手一報を省略する事象へ対策。`spawn-watcher.mjs`/`SESSION-MODE-TEMPLATE.md`で「最初の必須ツール呼び出し・省略厳禁」に強化（チーム連携の見える化＝信頼性）。反映は各Macで`install.sh`再実行。**2026-07-02 実機で発火を確認✅**（例：依頼→リーダー受付→『【リサーチャー】了解しました！すぐ着手します』が着手前に着信）。
✅**デモ動画v5 完成（2026-07-09〜10）**：縦49秒。SNS投稿依頼→LP依頼→**AI社員がLPを癒し系にリデザイン(index2.html)**→「これは簡易サンプル/指示次第でもっと高品質に」のアップセルカード→CTA。BGM=Tuesday Dub(YTオーディオライブラリ・商用OK)。字幕焼込・景表法OK。編集はClaude Codeがffmpegで直接実施(video担当の自作は後日)。詳細と素材の場所は`DEMO-VIDEO.md`。**残：オーナーがYouTube限定公開にアップ→URLをLINE「デモ」応答に設定→X固定にも動画アップ。**
✅**全社員が成果物を"実物"でLINE送信（画像＋動画）＋LUCENT AI社員デモ広告 完成（2026-07-19）**：`bin/send-line-image.mjs`を**`send-line-media.mjs`に拡張**（拡張子で画像/動画自動判定、動画はffmpegでサムネ生成→LINE動画メッセージ`{type:video}`）。完成報告ルールを**全社員共通層**(`templates/SESSION-MODE-TEMPLATE.md`)に追加＝どの社員も完成時にLINEへ実物を届ける（designer個別記述は共通層に統合）。秘密情報は`$OFFICE_HOME/.line-harness-key`(LINE_HARNESS_API_URL/KEY)・`.tunnel-cmd`の**鍵ファイルからinstall.shが注入**（gitに出さない）。**LUCENT AI社員デモ広告動画 完成**＝`~/line-ai-office/members/member-video/projects/ai-shain-ad-short-v1/final_video.mp4`（34秒/縦9:16/字幕BGM入り/テーマ「賢いAI社員＝ミス検知・正直報告・エラー対処を見せる」）。**★公式LUCENTポスター＝`member-designer/projects/lucent-poster-v3/poster-lucent-v3.png`（白スニーカー・オレンジソール・青+オレンジ2色ライン・NEVER ALONE）に確定**（photo-v2=全体オレンジ、photo-v3=AUTO PARTSは不採用）。**SNS投稿文4種(IG個人/IGビジネス/X/Threads)＋構成台本は`docs/DEMO-VIDEO-LUCENT-AD.md`**。Mac kitリポジトリは`~/Desktop`→**`~/maruchu-hp`へ移動済み**(iCloud退避/Desktop権限=TCC回避)。**残：①動画をX/IG/Threads/TikTokへ投稿(オーナー) ②Replicate$5チャージ(429対策) ③(任意)LINE内動画再生の最適化=faststart等 ④(任意)ngrokトークン再発行(スクショ露出)。**
✅**信頼性ハードニング＝"沈黙する穴"を追加で全部潰した（2026-07-22）**：コード精査で見つけた同種（黙って止まる）の穴を bridge/spawn-watcher で自己修復化。**bridge**：①アカウント対応表を起動時バックオフ再試行＋10分毎リフレッシュ＋未知UUID着信時に即時再取得（API一時不調で全社員沈黙→自動復帰）②未知UUID時に対応表が空ならオーナー通知 ③spawnハングを`SPAWN_TIMEOUT_MIN`(8分)でkill＋ロック解放 ④**利用上限(usage limit)検知**を追加（送信者一次応答＋オーナー通知）。**spawn-watcher（リーダー委任経路・穴が多かった）**：⑤子出力を社員別ログに取り込み失敗検知（ログイン切れ/利用上限）⑥**孤立task_doing.mdを`STALE_DOING_MIN`(10分)超で自動再キュー**（＝再起動でも直らなかった恒久停止が自動解消）⑦spawnタイムアウトkill ⑧異常終了は`MAX_TASK_RETRY`(2回)まで再キュー→超で`task_failed.md`退避＋通知（無限リトライ防止）。**横断**：⑨watchdogが`logs/*.log`を`LOG_MAX_MB`(5MB)超で切り詰め（ディスク逼迫防止）⑩watcherへLINE creds注入。しきい値は`office.conf`「信頼性しきい値」で調整可。**検証済み**：auth/usage正規表現の誤検知ゼロ・認証失敗再キュー・孤立復旧・タイムアウトkill・ログ切詰めを一時環境で実走確認。詳細`RUNBOOK.md`§F。実機反映は Mac で `bash install.sh` 再実行。
✅**テキスト成果物も"本文そのもの"をLINEに届けるルール追加（2026-07-22）**：画像/動画は実物がLINEに届くが、キャプション/投稿文/記事などの**テキスト成果物は「要約＋ファイルパス」だけ**でオーナーが`open`しないと読めない問題が残っていた（@lucent_autoparts案件で顕在化）。共通層`templates/SESSION-MODE-TEMPLATE.md`の完成報告ルールに「**テキスト成果物は本文そのものをLINEに送る**（`send_message`で貼付、約4,500字ごと分割、パスは補足、リーダーは中継時に要約で潰さない）」を追加。新規コード不要（プロンプト層のみ）。`docs/LINE-IMAGE-SETUP.md`も追記。＝**画像・動画・テキストのどれもLINEを見るだけで完結**（顧客がファイル場所を知らなくてよい＝商品価値）。実機反映は Mac で `bash install.sh` 再実行（各社員CLAUDE.md再生成）。
✅**ログイン切れ（認証失効）で全社員が沈黙する弱点に恒久対策（2026-07-22・実機発生→対策実装）**：ある日また「無反応」。切り分けたら**トンネルでもスリープでもなく、Claude Code のログイン(OAuth)失効**が真因だった（spawnしたclaudeが`401 OAuth access token has expired / Please run /login`で即死→AI社員は何も返せず、Claude自身が認証切れなので「切れた」とすら言えない＝完全沈黙）。Macで`/login`（1.Claude account with subscription）再ログインで即復旧。**恒久対策をキットに実装**（すべてClaude認証に非依存のNode/bash層）：①`bin/line-notify.mjs`（新規＝line-harness API直叩きのテキスト送信。認証切れでも飛ぶ通知路）②`office-bridge.mjs`がspawnログの401を検知→**送信者へ「少々お待ちください」自動返信＋オーナーへ「/loginして」通知**（10分抑制）③`bin/authwatch.sh`（新規＝既定6h毎に最小プロンプトで認証点検→切れてたら先回り通知。`office.conf`の`AUTH_WATCH`）④`watchdog.sh`がトンネル停止・bridge停止も**LINE通知**（15分毎常駐・連投抑制）。`install.sh`に`com.lineaioffice.watchdog`/`authwatch`常駐登録を追加。詳細は`RUNBOOK.md`§E。**キット反映・push済み（構文/検知テスト済み）。実機反映は Mac で `bash install.sh` 再実行が必要。** ＝「沈黙して顧客が離脱」を構造的に予防＝商品化の必須ブロッカーを解消。
✅**LINE自動起動＋画像表示 実機で完全動作（2026-07-18）**：翌朝「無反応」再発の真因は2つ＝①**Workerのビルド漏れ**（`wrangler deploy`単独ではTS未コンパイル→outgoing webhookの`lineAccountId`が空→bridgeが`UUID=undefined`で全無視）②**スリープでlaunchdごと停止**（caffeinateが一時タイマーのみ）。修正＝Workerを`vite build && wrangler deploy`で正式ビルド、caffeineを`com.lineaioffice.caffeinate`(keepalive・`caffeinate -s -i`)で恒久常駐、ngrokフラグを`--domain`→`--url`。**LINE1通→ターミナル操作なしで自動応答**を確認。さらに**成果物画像のLINE自動表示**を実装（imgbb不要、line-harness既存のR2 `POST /api/images`→公開URL→LINE画像メッセージ）＝顧客がファイル場所を知らなくても成果物が"画像"で見える＝商品価値UP。キット反映：`office.conf`(PREVENT_SLEEP/ngrok --url)・`install.sh`(caffeinate常駐)・`RUNBOOK`§6/§D・画像自動送信フロー(`roles/designer.md`)。
✅**トンネル切れの恒久対策 完了・実機で動作確認（2026-07-17）**：Mac再起動でトンネルが落ちると無反応になる既知の弱点を解消。**LINE 1通→ターミナル操作なしで担当AIが自動応答**を実機確認済み。方式＝**ngrokの無料固定ドメイン**（独自ドメイン不要）＋ launchd自動復帰。確定経路：`LINE→line-harness Worker(/webhook・変更なし)→line-harness Outgoing Webhook→ngrok固定URL(…ngrok-free.dev/webhook・launchd keepalive)→Mac bridge(:18789)→社員spawn`。キット側：`office.conf`の`TUNNEL_CMD`／`bin/tunnel-run.sh`／`install.sh`（`com.lineaioffice.tunnel`をkeepalive+RunAtLoad常駐）／`watchdog.sh`死活チェック（先頭語からngrok/cloudflaredを自動判定）。手順は`RUNBOOK.md`§D。**bridge修正（line-harness Outgoing Webhook形式の解析＋UUID→メンバー解決）とWorker修正（payloadに`lineAccountId`追加）はMac実機で実施済み。キット源`bin/office-bridge.mjs`への反映のみ残（Mac側Claude Codeからpush予定）。** ngrokトークンはスクショに露出したため後日再発行推奨。
次にやること：
- サービス紹介ページ（note/LP）ができたらリッチメニューCを外部リンクにしてもよい。
- ✅**Stripe決済 完了（2026-07-02・通しテスト成功）**（詳細 `docs/STRIPE-SETUP.md`）：商品2つ（初期¥39,800一括＋月¥9,800サブスク）→まとめPayment Link発行（初回¥49,600→翌月以降¥9,800/月）→特商法/PPをnoteで公開しStripe登録→公式LINEに「申込」キーワード応答を登録（送ると決済リンク自動返信）。カード(+Apple Pay)で稼働。明細書表記=LUCENTに統一。コンビニ/銀行振込は050電話用意後に有効化予定。決済リンクは相談成約者にのみ案内。
- **実演デモ動画**を作る（LINEの「デモ」返信用・X固定用。顔出し可）。
- **X継続運用**：`X-LAUNCH-30DAYS.md` に沿って投稿＋リプ周り。
- **弁護士相談**：`LEGAL-QUESTIONS.md` の論点（顧客名義Claudeの代理運用・特商法・契約書 等）。
- **顧客Mac/Claudeの構築手段を最終確定＆手順化**（`MULTI-TENANT-SETUP.md`）。
- （任意）THIRD-PARTY-LICENSES（line-harness のMIT表記）同梱。
- ※実機で要確認の宿題：launchd常駐の複数ユーザー同時運用・将来のAPI方式(い)移行。
