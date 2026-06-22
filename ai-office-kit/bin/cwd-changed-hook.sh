#!/bin/bash
# =============================================================
#  LINE AIオフィス — cwd-changed-hook（フック②）
#
#  社員ディレクトリに cd した時に「起動ルーチン（5分Cron監視）」を注入する。
#  ※ ~/.claude/settings.json の hooks.CwdChanged に登録して発火する。
#
#  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
#    OFFICE_HOME      … オフィス本体の基準パス（必須）
#    MCP_NAME         … line-harness MCP のサーバ名（既定 'line-harness'）
#    LEADER_ID        … リーダーの社員dir/アカウント（既定 'member-leader'）
#    OWNER_FRIEND_ID  … オーナーの friendId（既定 'owner'）
# =============================================================

OFFICE_HOME="${OFFICE_HOME:-$HOME/ai-office}"
MCP_NAME="${MCP_NAME:-line-harness}"
LEADER_ID="${LEADER_ID:-member-leader}"
OWNER_FRIEND_ID="${OWNER_FRIEND_ID:-owner}"

input=$(cat)
new_cwd=$(printf '%s' "$input" | jq -r '.cwd // .newCwd // .new_cwd // .data.cwd // empty' 2>/dev/null)
if [ -z "$new_cwd" ] || [ "$new_cwd" = "null" ]; then
  new_cwd="$PWD"
fi

# 任意の OFFICE_HOME に対応：パス中の members/<dir> から社員dirを取り出す
DIR=$(printf '%s' "$new_cwd" | sed -n 's|.*/members/\([^/]*\)\(/.*\)\{0,1\}$|\1|p')

# 実在する社員ディレクトリでなければ何もしない
[ -n "$DIR" ] || exit 0
[ -d "$OFFICE_HOME/members/$DIR" ] || exit 0

ID="$DIR"

# 表示名は office-members.json から解決（無ければ member- を外した名前）
DISPLAY="${ID#member-}"
MANIFEST="$OFFICE_HOME/office-members.json"
if command -v jq >/dev/null 2>&1 && [ -f "$MANIFEST" ]; then
  N=$(jq -r --arg d "$ID" '.members[] | select(.dir==$d) | .name' "$MANIFEST" 2>/dev/null)
  [ -n "$N" ] && [ "$N" != "null" ] && DISPLAY="$N"
fi

if [ "$ID" = "$LEADER_ID" ]; then
  DIRECTIVE=$(cat <<EOF
【${DISPLAY}（リーダー）ディレクトリに入りました：セッション起動ルーチン（確認不要で即実行）】
1. CronCreateで5分おき監視Cronを起動する。cron="*/5 * * * *"、prompt は以下：
   「(A) mcp__${MCP_NAME}__get_ai_conversations (lineAccountId: ${LEADER_ID}, limit: 20) で新着確認。大方針メッセージがあれば：①自分で戦略立案＋タスク分解、②各担当の ${OFFICE_HOME}/members/{担当dir}/inbox/task.md を作成（依頼元／目的／やること／成果物パス／完了条件）、③mcp__${MCP_NAME}__send_message (accountId: ${LEADER_ID}, friendId: ${OWNER_FRIEND_ID}) でオーナーに方針報告＋該当セッション起動依頼。
   (B) 各担当の進捗（完了・質問・報告）は各担当自身が自分のLINEからオーナーに直接送る。リーダーは担当ごとの進捗報告をしない。
   (C) 各担当の inbox/task_done.md は cleanup として削除のみ（報告不要）。inbox/task.md が長時間残っていればセッション起動をオーナーにリマインドしてよい。」

2. 直後に一度同じチェックを実行。
3. CLAUDE.md の役割仕様に完全準拠。
EOF
)
else
  DIRECTIVE=$(cat <<EOF
【${DISPLAY}ディレクトリに入りました：セッション起動ルーチン（確認不要で即実行）】
1. CronCreateで5分おき監視Cronを起動する。cron="*/5 * * * *"、prompt は以下：
   「(A) inbox/task.md があれば：内容を読み、作業方針の不明点を3〜5個リストアップ（番号選択式で明確に）。mcp__${MCP_NAME}__send_message (accountId: ${ID}, friendId: ${OWNER_FRIEND_ID}) でオーナーに質問送信 → task.md を task_asked.md にリネーム。
   (B) inbox/task_asked.md があれば：mcp__${MCP_NAME}__get_ai_conversations (lineAccountId: ${ID}, limit: 20) で自分のLINEを確認。オーナーの回答があれば、回答を加味して作業開始。完了時は成果物パスを自分のLINEでオーナーに報告 → task_asked.md を task_done.md にリネーム。
   (C) task.md がタスク内容完全明快で質問不要と判断できる場合のみ、質問スキップして即作業 → 完了時LINE報告＋task_done.md化。迷ったら質問する。」

2. 直後に一度同じチェックを実行。
3. オーナーへの質問・進捗・完了報告は必ず自分のLINE（${ID}）から送信。リーダー経由にしない。
4. CLAUDE.md の役割仕様に完全準拠。
EOF
)
fi

jq -n --arg ctx "$DIRECTIVE" '{
  hookSpecificOutput: {
    hookEventName: "CwdChanged",
    additionalContext: $ctx
  }
}'
