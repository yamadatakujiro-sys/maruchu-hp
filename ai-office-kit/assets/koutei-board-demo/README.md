# みんなの工程ボード（体験版）

> 🚚 2026-10-21：本体は auto-repair-dx リポジトリの `apps/koutei-board/` に移行。ここは公開URL（`/koutei/`）を守るために残している控え。直すときは両方を同じ内容にする。

- **公開URL（DMで送るのはこれ）**：
  https://yamadatakujiro-sys.github.io/maruchu-hp/koutei/ （PR #23 のマージで公開。2026-10-20 オーナー許可で Pages のワークフローに /koutei/ を追加）
  - GitHub Pages から配信（**ログイン不要・誰でも開ける**）。`.github/workflows/deploy-pages.yml` が、`nail-sample/`（Lino）を直下に、この `index.html` を `/koutei/` にまとめて公開する。main でこの index.html を直すと自動で出し直される。
  - 公開元は Settings → Pages の「GitHub Actions」（main への push で自動デプロイ）。
- 作業用の元：オーナーのアーティファクト https://claude.ai/artifact/EnuYdQzqL7xJqhjK2UpQWs （非公開。2026-10-20、オーナーのアプリで「ページが見つかりません」になったため、送る先には使わない）
- このフォルダの `index.html` が公開版の本体。head に title・lang="ja"・OGP（LINE等で貼ったときの表示）を入れてある。
- 本番の想定：社員がいつものLINEで「◯◯さんの△△、□□終わった」と打つ（喋る）→ Claude が読んで判断 → Googleスプレッドシートの車を次の工程へ動かす → 全員のスマホに反映。納期の重なり・遅れは LINE で先回り通知。
- **体験版は決まりで動く**（客名・車種と工程の言葉を拾うだけ。AIは呼んでいない）。下の注意書きに「体験版は決まった言い方で動きます。中の名前・車は架空です。」と明記（2026-10-20 追加）。
- 中の名前・車・日付（8/13）は架空。
- 使い道：ルーセントのリール（`../lucent-ai-series/koutei-reel.mp4`）で「DMで『ボード』と送ってください」→ このリンクを送る／取引先には配達のついでにスマホで見せる。
- 元になった案件：auto-repair-dx リポジトリの `docs/cases/CASE-mochizuki-whiteboard.md`（社名・地域は投稿に出さない）。
