#!/bin/bash
# =============================================================
#  LINE AIオフィス — authwatch（Claudeログイン切れの"先回り"点検）
#
#  なぜ必要か：
#    push型では LINE着信で claude を spawn するが、Claude Code のログイン(OAuth)が
#    切れていると spawn した claude が 401 で即死し、AI社員が完全に沈黙する。
#    bridge も 401 を検知してLINE通知するが、それは「誰かがLINEを送った時」。
#    authwatch は**誰も送っていない時間帯でも定期的に認証の生死を点検**し、
#    切れていたらオーナーに先回りで「/loginして」と通知する（顧客が気づく前に直せる）。
#
#  コスト：1回あたり最小プロンプト（"ok"1語）の極小消費のみ。既定は launchd で数時間おき。
#
#  設定（install.sh が office.conf から環境に流し込む）：
#    OFFICE_HOME       … 基準パス（必須）
#    CLAUDE_BIN        … claude 実行ファイル（既定 claude）
#    OWNER_FRIEND_ID   … 通知先 friendId
# =============================================================
set -uo pipefail

: "${OFFICE_HOME:?OFFICE_HOME が未設定です（office.conf を確認）}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
NOTIFY_BIN="$OFFICE_HOME/bin/line-notify.mjs"
NODE_BIN="$(command -v node || echo node)"
NOW_TS=$(date +%s)
STAMP="$OFFICE_HOME/logs/.alert-authwatch.ts"
COOLDOWN_SEC="${ALERT_COOLDOWN_SEC:-1800}"
AUTH_ERROR_RE='Please run /login|OAuth access token has expired|Invalid authentication credentials|Re-authenticate to continue'
USAGE_LIMIT_RE='usage limit reached|Claude usage limit|limit will reset at|rate limit|Too Many Requests'

mkdir -p "$OFFICE_HOME/logs"

# 認証を最小プロンプトで点検（実作業はさせない・cwd は / でCLAUDE.md非読込＝軽量）
OUT="$(cd / && "$CLAUDE_BIN" -p 'reply with exactly: ok' --permission-mode bypassPermissions 2>&1)"

# 連投抑制つきでオーナー通知
notify() {
  last=0; [ -f "$STAMP" ] && last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ $(( NOW_TS - last )) -ge "$COOLDOWN_SEC" ] && [ -n "${OWNER_FRIEND_ID:-}" ]; then
    echo "$NOW_TS" > "$STAMP"
    "$NODE_BIN" "$NOTIFY_BIN" --to "$OWNER_FRIEND_ID" "$1" >/dev/null 2>&1 || true
  fi
}

if printf '%s' "$OUT" | grep -Eiq "$AUTH_ERROR_RE"; then
  echo "⚠ AUTH DOWN: Claude のログインが切れています（authwatch）。"
  notify "🔔【定期点検】AI社員のログイン(認証)が切れています。Macで Claude Code を開き /login で再ログインしてください。今のうちに直せば無反応を防げます。"
elif printf '%s' "$OUT" | grep -Eiq "$USAGE_LIMIT_RE"; then
  echo "⚠ USAGE LIMIT: Claude の利用上限に達しています（authwatch）。"
  notify "🔔【定期点検】Claudeの利用上限に達しています。リセットまで待つか、上位プランをご検討ください。それまでAI社員の応答が不安定になります。"
else
  echo "✓ AUTH OK（authwatch）"
fi
