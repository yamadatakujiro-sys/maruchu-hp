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
#    PORT           … bridge 待受ポート（既定 18789・死活確認に使用）
#    TUNNEL_CMD     … トンネル起動コマンド（設定時のみトンネル死活を監視）
#    OWNER_FRIEND_ID… アラートのLINE通知先（line-notify.mjs 経由）
# =============================================================
set -euo pipefail

: "${OFFICE_HOME:?OFFICE_HOME が未設定です（office.conf を確認）}"
THRESHOLD_MIN="${THRESHOLD_MIN:-60}"
PORT="${PORT:-18789}"

ROOT="$OFFICE_HOME"
NOW_TS=$(date +%s)

# --- LINE通知ヘルパ（連投抑制つき・Claude認証に非依存）----------------------
# 同じ種類のアラートは既定30分に1回まで（状態ファイルで抑制）。障害通知でLINEを埋めない。
NOTIFY_BIN="$OFFICE_HOME/bin/line-notify.mjs"
ALERT_COOLDOWN_SEC="${ALERT_COOLDOWN_SEC:-1800}"
NODE_BIN="$(command -v node || echo node)"
notify_owner() {
  # $1=アラート種別キー（抑制の単位）  $2=本文
  local key="$1" text="$2"
  local stamp="$OFFICE_HOME/logs/.alert-${key}.ts"
  local last=0
  [ -f "$stamp" ] && last="$(cat "$stamp" 2>/dev/null || echo 0)"
  if [ $(( NOW_TS - last )) -lt "$ALERT_COOLDOWN_SEC" ]; then return 0; fi
  echo "$NOW_TS" > "$stamp"
  [ -n "${OWNER_FRIEND_ID:-}" ] || return 0
  "$NODE_BIN" "$NOTIFY_BIN" --to "$OWNER_FRIEND_ID" "$text" >/dev/null 2>&1 || true
}

# --- トンネル死活（TUNNEL_CMD 運用時のみ）------------------------
# トンネル(ngrok / cloudflared 等)が落ちていると LINE 着信が bridge に届かず無反応になる（RUNBOOK §D）。
if [ -n "${TUNNEL_CMD:-}" ]; then
  # TUNNEL_CMD の先頭語＝トンネル実体のプロセス名（例: ngrok / cloudflared）
  TUNNEL_BIN="${TUNNEL_CMD%% *}"
  TUNNEL_BIN="$(basename "$TUNNEL_BIN")"
  if ! pgrep -f "$TUNNEL_BIN" >/dev/null 2>&1; then
    echo "⚠ TUNNEL DOWN: $TUNNEL_BIN が動いていません（LINE着信が届かない状態）。launchd の com.lineaioffice.tunnel を確認"
    notify_owner "tunnel" "⚠️ トンネル($TUNNEL_BIN)が停止しLINE着信が届きません。Macの再起動、または launchd(com.lineaioffice.tunnel)の復帰を確認してください。"
  fi
fi

# --- bridge 死活（受け口そのものが落ちていないか）----------------
# bridge が落ちると LINE 着信を誰も受け取れず全無反応になる。
if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "⚠ BRIDGE DOWN: 127.0.0.1:$PORT/health が無応答（受け口停止＝全無反応）。launchd の com.lineaioffice.bridge を確認"
    notify_owner "bridge" "⚠️ AIオフィスの受け口(bridge)が停止しています。Macで launchd(com.lineaioffice.bridge)の復帰、またはキットで bash install.sh を実行してください。"
  fi
fi

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
