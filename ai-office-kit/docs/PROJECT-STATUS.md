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

## 3. 確定した決定事項
- **v1出荷=8職種**：leader / lp / designer / writer / video / sns / researcher / analyst。
  - product（自社テンプレ依存）は当面除外。brunson（市販書籍複製で著作権リスク）は商品から除外。
- **動作モードの既定は push**（`MODE="push"`）。LINE着信時のみ動く＝**待機トークン消費ほぼゼロ**。
  - poll運用（受付係30秒＋5分Cron監視）は即応性高いが常時消費。必要時のみ `MODE="poll"`。
- **販売の提供モデルは A（顧客のMacに構築・引き渡し）を主軸**に決定（2026-06-28）。
  - 理由：販売者(オーナー)の運用負担・責任が軽い。非技術者でも構築できた実績あり。
  - A の弱点＝顧客側の運用ハードル（Mac常時起動／顧客のClaude契約・利用料／止まった時のサポート）。
    対策：常時起動Macを持てる顧客に絞る／push運用で消費最小化／購入前に必須条件を明記／RUNBOOKのFAQを渡す。
  - 将来、常時起動が難しい顧客向けに B（運用代行・月額）を上位/別プランで足す余地あり。
- **価格**：方針は「まず実績作り→段階的に値上げ」。具体額は**未確定**（市場リサーチが利用枠オーバーで中断）。
  枠回復後に競合実価格を裏取りして確定する。現状の数値はすべて「仮・たたき台」。
- **販路・集客**：ココナラ＝受注/決済、**X（旧Twitter）＝集客の主軸**、顔出しショート動画で実演、note/ブログ=信頼。
  販売者は顔出し動画OK。X-LAUNCH-30DAYS.md に初動プランあり。

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

## 7. 次にやる候補（未着手）
- 価格の確定（市場リサーチを枠回復後に再開→競合裏取り→3プラン実数）。
- ココナラ出品文の本番版（モデルA前提で書き切る）。
- X運用の実行（30日プランに沿って発信開始）。
- Claude利用枠/規約まわりの整理（モデルAなら顧客名義が基本）。
- （任意）省トークン設定の節を RUNBOOK/PRODUCT-SUPPORT に追記。
- （任意）THIRD-PARTY-LICENSES（line-harness のMIT表記）同梱。
