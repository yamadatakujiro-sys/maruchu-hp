#!/bin/bash
# =============================================================
#  LINE AIオフィス — leader-poll（受付係）
#
#  リーダーとして claude を起動し、オーナーとの会話を直接読んで
#  (1)LINE返信 (2)担当の inbox/task.md へ振り分け を行う。多重起動はロックで防止。
#
#  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
#    OFFICE_HOME      … オフィス本体の基準パス（必須）
#    CLAUDE_BIN       … claude 実行ファイル（既定 'claude'）
#    MCP_NAME         … line-harness MCP のサーバ名（既定 'line-harness'）
#    LEADER_ID        … リーダーの社員dir（既定 'member-leader'）
#    MEMBER_ROUTING   … 振り分けヒント（例: "LP担当=member-lp, デザイナー=member-designer, ..."）
# =============================================================
set -u

: "${OFFICE_HOME:?OFFICE_HOME が未設定です（office.conf を確認）}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MCP_NAME="${MCP_NAME:-line-harness}"
LEADER_ID="${LEADER_ID:-member-leader}"
MEMBER_ROUTING="${MEMBER_ROUTING:-（担当の対応表は各自の CLAUDE.md と members/ 配下のフォルダ名を参照）}"

# オフィスごとに一意なロック（同一Macで複数オフィスを動かしても衝突しない）
LOCK="/tmp/lineaioffice-leader-poll-$(echo "$OFFICE_HOME" | tr '/' '_').lock"
if [ -e "$LOCK" ]; then
  P=$(cat "$LOCK" 2>/dev/null)
  if kill -0 "$P" 2>/dev/null; then exit 0; fi
fi
echo $$ > "$LOCK"

# CLAUDE_BIN のあるディレクトリを PATH 先頭へ
BIN_DIR="$(dirname "$CLAUDE_BIN")"
export PATH="$BIN_DIR:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
unset ANTHROPIC_API_KEY

LOG="$OFFICE_HOME/logs/leader-poll.log"
mkdir -p "$OFFICE_HOME/logs"

cd "$OFFICE_HOME/members/$LEADER_ID" || { rm -f "$LOCK"; exit 1; }
echo "[$(date '+%Y-%m-%d %H:%M:%S')] リーダーがLINEを確認中..." >> "$LOG"

"$CLAUDE_BIN" -p "あなたはリーダーです。${MCP_NAME} のMCPツールで、オーナー（リーダーアカウントに友だち登録された相手）との会話を get_conversation で直接取得してください。get_ai_conversations は使わないこと。あなたが最後に送信したメッセージより後に、オーナーから届いた未返信メッセージがあれば対応します：(1)LINEで適切に返信し、(2)作業依頼なら担当の inbox/task.md に依頼内容を書いて振り分けてください（担当の対応: ${MEMBER_ROUTING}）。【最重要】担当は inbox/task.md を置けば自動で起動して作業する仕組みが既に動いています。オーナーへの返信で『ターミナルを開いて』『cd ... && claude』等の操作を依頼しては絶対にいけません。代わりに『〇〇担当が自動で着手します。完了したらこのトークに【担当名】付きで報告します』と伝えてください。同じ依頼が複数回届いていれば1回にまとめること。未返信メッセージが無ければ何もせず終了してください。" --permission-mode bypassPermissions >> "$LOG" 2>&1

rm -f "$LOCK"
