#!/bin/bash
# =============================================================
#  LINE AIオフィス — watchdog（死活監視）
#
#  各社員の inbox/task.md / task_asked.md が一定時間以上残っていたらアラート。
#  使い方: bash watchdog.sh
#  推奨   : crontab で30分おきに実行
#
#  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
#    OFFICE_HOME    … オフィス本体の基準パス（必須）
#    THRESHOLD_MIN  … 滞留アラートの閾値（分・既定 60）
# =============================================================
set -euo pipefail

: "${OFFICE_HOME:?OFFICE_HOME が未設定です（office.conf を確認）}"
THRESHOLD_MIN="${THRESHOLD_MIN:-60}"

ROOT="$OFFICE_HOME"
NOW_TS=$(date +%s)

# 社員一覧は members/*/inbox を持つディレクトリから自動取得
shopt -s nullglob
for INBOX in "$ROOT"/members/*/inbox; do
  MEMBER_DIR="$(basename "$(dirname "$INBOX")")"
  for STATE in task task_asked; do
    F="$INBOX/$STATE.md"
    [ -f "$F" ] || continue
    # mtime 取得（Linux: stat -c %Y を先に試し、ダメなら macOS: stat -f %m）
    MTIME=$(stat -c %Y "$F" 2>/dev/null || stat -f %m "$F")
    AGE_MIN=$(( (NOW_TS - MTIME) / 60 ))
    if [ "$AGE_MIN" -ge "$THRESHOLD_MIN" ]; then
      echo "⚠ STALL: $MEMBER_DIR / $STATE.md (${AGE_MIN} min old)"
      # ここに Slack/LINE 通知を入れる場合は curl ... を追加
    fi
  done
done
